import { expect } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './db'
import type { FixtureRole } from './users'

/** Every row a deposit spec creates carries this run tag in customer_name, and afterAll deletes by it. */
export const RUN = `E2E-${Date.now().toString(36)}`

export async function createDeposit(role: FixtureRole, opts: { qty?: number; branch?: 'A' | 'B'; customerId?: string; photo?: boolean; expiresAt?: string } = {}) {
  const { branchA, branchB } = fixtureIds()
  const { data, error } = await dbAs(role).rpc('create_deposit', {
    p_branch: opts.branch === 'B' ? branchB : branchA,
    p_customer_name: `${RUN} ลูกค้า`,
    p_item_name: 'Johnnie Walker Black Label',
    p_quantity: opts.qty ?? 3,
    p_photo_paths: opts.photo === false ? [] : [`${branchA}/e2e/receive.jpg`],
    p_customer_phone: '081-234-5678',
    p_table: 'A3',
    p_customer_id: opts.customerId,
    p_expires_at: opts.expiresAt,
  })
  return { data: data as { id: string; code: string } | null, error }
}

export async function mustCreate(role: FixtureRole, opts: Parameters<typeof createDeposit>[1] = {}) {
  const { data, error } = await createDeposit(role, opts)
  expect(error, error?.message).toBeNull()
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

export async function confirmAll(id: string, levels: number[]) {
  const { error } = await dbAs('bar').rpc('confirm_deposit', { p_deposit: id, p_levels: levels, p_photo_paths: ['confirm.jpg'] })
  expect(error, error?.message).toBeNull()
}

/** Remove everything this run created (deposits cascade to bottles, withdrawals, events). */
export async function cleanupRun() {
  const admin = adminDb()
  const { data } = await admin.from('deposits').select('id').like('customer_name', `${RUN}%`).range(0, 999)
  const ids = (data ?? []).map((d) => d.id)
  if (ids.length) {
    await admin.from('line_outbox').delete().in('payload->>deposit_id', ids)
    await admin.from('deposits').delete().in('id', ids)
  }
  await admin.from('customers').delete().like('display_name', `${RUN}%`)
}
