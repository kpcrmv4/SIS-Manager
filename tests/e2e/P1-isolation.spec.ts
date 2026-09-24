import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { addDays, businessNight } from '../../src/lib/date'
import { adminDb, dbAs, fixtureIds, sql } from './fixtures/db'
import { RUN, bottles, cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { required } from './fixtures/env'

/**
 * P1-RLS-01: the cross-branch sweep. Branch B gets at least one row in every
 * branch-scoped table while the line runs; staff@A and bar@A must see none of them.
 */
test.describe.configure({ mode: 'serial' })

const BRANCH_TABLES = [
  'deposits', 'withdrawals', 'deposit_events', 'bookings', 'table_zones', 'tables',
  'booking_settings', 'booking_blackouts', 'print_jobs', 'liquor_items', 'customer_vips',
] as const

/** a VIP phone for branch B that no deposit uses (R-048) */
const VIP_PHONE = `09${String(Date.now() % 100_000_000).padStart(8, '0')}`

test.beforeAll(async () => {
  const { branchB } = fixtureIds()
  const admin = adminDb()
  const d = await mustCreate('staffB', { qty: 1, branch: 'B' })
  // staff cannot confirm; the owner (every branch) does, so the B deposit can take a withdrawal
  await confirmAll(d.id, [100], 'owner')
  const b = await bottles(d.id)
  const w = await dbAs('staffB').rpc('request_withdrawal', { p_deposit: d.id, p_bottle_ids: [b[0].id], p_type: 'take_home' })
  expect(w.error, w.error?.message).toBeNull()
  const z = await admin.from('table_zones').insert({ branch_id: branchB, name: `${RUN}-zone` }).select('id').single()
  await admin.from('tables').insert({ branch_id: branchB, zone_id: z.data!.id, label: 'ZB1' })
  await admin.from('booking_blackouts').insert({ branch_id: branchB, night: addDays(businessNight(), 30), reason: RUN })
  await admin.from('print_jobs').insert({ branch_id: branchB, job_type: 'receipt', payload: { run: RUN } })
  await admin.from('liquor_items').insert({ branch_id: branchB, name: `${RUN}-item` })
  const vip = await admin.from('customer_vips').insert({ branch_id: branchB, phone_key: VIP_PHONE })
  expect(vip.error, vip.error?.message).toBeNull()
  const bk = await dbAs('staffB').rpc('create_booking', { p_branch: branchB, p_night: businessNight(), p_slot: '21:00', p_party: 2, p_name: `${RUN} booking` } as never)
  expect(bk.error, bk.error?.message).toBeNull()
})

test.afterAll(async () => {
  const { branchB } = fixtureIds()
  const admin = adminDb()
  await cleanupRun()
  await admin.from('bookings').delete().eq('branch_id', branchB)
  await admin.from('tables').delete().eq('branch_id', branchB)
  await admin.from('table_zones').delete().eq('branch_id', branchB)
  await admin.from('booking_blackouts').delete().eq('branch_id', branchB)
  await admin.from('print_jobs').delete().eq('branch_id', branchB)
  await admin.from('liquor_items').delete().like('name', `${RUN}%`)
  await admin.from('customer_vips').delete().eq('branch_id', branchB).eq('phone_key', VIP_PHONE)
})

test('P1-RLS-01 cross-branch sweep: every branch table has a B row, staff@A and bar@A see none', async () => {
  const { branchB } = fixtureIds()
  for (const table of BRANCH_TABLES) {
    const { count } = await adminDb().from(table).select('*', { count: 'exact', head: true }).eq('branch_id', branchB)
    expect(count, `${table} has a branch B row`).toBeGreaterThan(0)
    for (const role of ['staff', 'bar'] as const) {
      const { data, error } = await dbAs(role).from(table).select('branch_id').eq('branch_id', branchB).range(0, 9)
      expect(error, `${role} ${table}: ${error?.message}`).toBeNull()
      expect(data, `${role} reads ${table} of branch B`).toEqual([])
    }
    const { data: own } = await dbAs('owner').from(table).select('branch_id').eq('branch_id', branchB).range(0, 0)
    expect(own, `owner reads ${table} of branch B`).toHaveLength(1)
  }
  // bottles have no branch_id — reached through their deposit
  const { data: bRows } = await adminDb().from('deposits').select('id').eq('branch_id', branchB).range(0, 0)
  const { data: leak } = await dbAs('staff').from('deposit_bottles').select('id').eq('deposit_id', bRows![0].id)
  expect(leak).toEqual([])
})

test('P1-RLS-03 anon has no table grant anywhere in public', async () => {
  const rows = await sql<{ n: number }>("select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'")
  expect(rows[0].n).toBe(0)
  const fns = await sql<{ proname: string }>(
    "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and has_function_privilege('anon', p.oid, 'execute') and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype order by 1",
  )
  expect(fns.map((f) => f.proname)).toEqual([])
})

test('P1-RLS-04 security advisors report no ERROR', async () => {
  const ref = required('SUPABASE_PROJECT_REF')
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/advisors/security`, {
    headers: { Authorization: `Bearer ${required('SUPABASE_ACCESS_TOKEN')}` },
  })
  expect(res.ok).toBe(true)
  const { lints } = (await res.json()) as { lints: { level: string; name: string }[] }
  expect(lints.filter((l) => l.level === 'ERROR').map((l) => l.name)).toEqual([])
})

test('P1-CON-01 generated types carry every table and RPC of the contract', () => {
  const types = readFileSync('src/types/database.ts', 'utf8')
  const rpcs = [
    'create_deposit', 'staff_receive_request', 'confirm_deposit', 'reject_deposit', 'request_withdrawal',
    'complete_withdrawals', 'reject_withdrawal', 'extend_deposit', 'set_vip', 'dispose_deposits',
    'expire_due_deposits', 'send_expiry_notices', 'customer_request_deposit', 'link_deposit_customer',
    'create_booking', 'confirm_booking', 'reject_booking', 'assign_table', 'check_in_booking',
    'cancel_booking', 'mark_no_shows', 'booking_availability', 'send_booking_reminders',
    'claim_outbox', 'finish_outbox', 'login_throttle', 'login_record',
    'customer_list', 'customer_detail', 'set_customer_vip',
  ]
  const tables = [
    'branches', 'branch_line_secrets', 'profiles', 'user_branches', 'liquor_items', 'customers', 'deposits',
    'deposit_bottles', 'withdrawals', 'deposit_events', 'table_zones', 'tables', 'booking_settings',
    'booking_blackouts', 'bookings', 'line_outbox', 'notifications', 'push_subscriptions', 'print_jobs', 'print_stations',
    'customer_vips',
  ]
  for (const name of [...rpcs, ...tables]) expect(types, name).toMatch(new RegExp(`\\n\\s{6}${name}: \\{`))
})
