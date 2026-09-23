import { expect } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './db'
import type { FixtureRole } from './users'

/** Every row a deposit spec creates carries this run tag in customer_name, and afterAll deletes by it. */
export const RUN = `E2E-${Date.now().toString(36)}`

const photoCache = new Map<string, string>()

/** A real JPEG in the branch's folder — the database refuses paths that are not stored objects there. */
export async function photo(branch: 'A' | 'B' = 'A'): Promise<string> {
  const hit = photoCache.get(branch)
  if (hit) return hit
  const { branchA, branchB } = fixtureIds()
  const path = `${branch === 'B' ? branchB : branchA}/e2e/fixture.jpg`
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])
  const { error } = await adminDb().storage.from('deposit-photos').upload(path, jpg, { contentType: 'image/jpeg', upsert: true })
  expect(error, error?.message).toBeNull()
  photoCache.set(branch, path)
  return path
}

export async function createDeposit(role: FixtureRole, opts: { qty?: number; branch?: 'A' | 'B'; photo?: boolean; expiresAt?: string } = {}) {
  const { branchA, branchB } = fixtureIds()
  const { data, error } = await dbAs(role).rpc('create_deposit', {
    p_branch: opts.branch === 'B' ? branchB : branchA,
    p_customer_name: `${RUN} ลูกค้า`,
    p_item_name: 'Johnnie Walker Black Label',
    p_quantity: opts.qty ?? 3,
    p_photo_paths: opts.photo === false ? [] : [await photo(opts.branch ?? 'A')],
    p_customer_phone: '081-234-5678',
    p_table: 'A3',
    p_expires_at: opts.expiresAt,
  })
  return { data: data as { id: string; code: string } | null, error }
}

/** Create as `role`; with `customerId`, link it the only way the system allows — the receipt token, as the service role. */
export async function mustCreate(role: FixtureRole, opts: Parameters<typeof createDeposit>[1] & { customerId?: string } = {}) {
  const { customerId, ...rest } = opts
  const { data, error } = await createDeposit(role, rest)
  expect(error, error?.message).toBeNull()
  if (customerId) {
    const row = await deposit(data!.id)
    const { error: linkError } = await adminDb().rpc('link_deposit_customer', { p_branch: row.branch_id, p_token: row.link_token, p_customer_id: customerId })
    expect(linkError, linkError?.message).toBeNull()
  }
  return data!
}

export async function deposit(id: string) {
  const { data, error } = await adminDb().from('deposits').select('*').eq('id', id).single()
  expect(error, error?.message).toBeNull()
  return data!
}

export async function bottles(id: string) {
  const { data } = await adminDb().from('deposit_bottles').select('id, bottle_no, remaining_percent, status').eq('deposit_id', id).order('bottle_no')
  return data ?? []
}

export async function confirmAll(id: string, levels: number[], role: FixtureRole = 'bar') {
  const row = await deposit(id)
  const branch = row.branch_id === fixtureIds().branchB ? 'B' : 'A'
  const { error } = await dbAs(role).rpc('confirm_deposit', { p_deposit: id, p_levels: levels, p_photo_paths: [await photo(branch)] })
  expect(error, error?.message).toBeNull()
}

/** Remove everything this run created (deposits cascade to bottles, withdrawals, events). */
export async function cleanupRun() {
  const admin = adminDb()
  const { data } = await admin.from('deposits').select('id').like('customer_name', `${RUN}%`).range(0, 999)
  const ids = (data ?? []).map((d) => d.id)
  if (ids.length) {
    await admin.from('line_outbox').delete().in('payload->>deposit_id', ids)
    await admin.from('print_jobs').delete().in('deposit_id', ids)
    await admin.from('deposits').delete().in('id', ids)
  }
  await admin.from('customers').delete().like('display_name', `${RUN}%`)
}
