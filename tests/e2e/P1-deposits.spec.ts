import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { RUN, bottles, cleanupRun, confirmAll, createDeposit, deposit, mustCreate } from './fixtures/deposits'

/**
 * P1-02 deposit state machine at the database: every transition through its RPC,
 * every forbidden one refused, and the DB delta read back through the service role.
 */
test.describe.configure({ mode: 'serial' })

const admin = () => adminDb()
let customerId = ''
const LINE_USER = `U${'e2e0'.repeat(8)}`

test.beforeAll(async () => {
  const { data, error } = await admin()
    .from('customers')
    .upsert({ line_user_id: LINE_USER, display_name: `${RUN} LINE`, locale: 'en' }, { onConflict: 'line_user_id' })
    .select('id')
    .single()
  expect(error, error?.message).toBeNull()
  customerId = data!.id
})

test.afterAll(async () => {
  await cleanupRun()
  const { branchA } = fixtureIds()
  await admin().from('branches').update({ withdrawal_blocked_days: ['Fri', 'Sat'], staff_group_id: null }).eq('id', branchA)
})

test('P1-DEP-01 staff receives 3 bottles: pending_confirm, code, sealed bottles, event, 30-day expiry', async () => {
  const before = Date.now()
  const d = await mustCreate('staff', { qty: 3 })
  expect(d.code).toMatch(/^DEP-ZTA-[A-Z0-9]{5}$/)
  const row = await deposit(d.id)
  expect(row.status).toBe('pending_confirm')
  expect(row.quantity).toBe(3)
  expect(row.remaining_qty).toBe(3)
  const days = (new Date(row.expires_at!).getTime() - before) / 86400000
  expect(days).toBeGreaterThan(29.9)
  expect(days).toBeLessThan(30.1)
  expect(row.collect_deadline_at).not.toBeNull()
  const b = await bottles(d.id)
  expect(b.map((x) => [x.bottle_no, x.status, Number(x.remaining_percent)])).toEqual([
    [1, 'sealed', 100],
    [2, 'sealed', 100],
    [3, 'sealed', 100],
  ])
  const { data: ev } = await admin().from('deposit_events').select('action, actor_kind').eq('deposit_id', d.id)
  expect(ev).toEqual([{ action: 'received', actor_kind: 'staff' }])
})

test('P1-DEP-02 staff without a photo is refused and nothing is written', async () => {
  const { count: before } = await admin().from('deposits').select('id', { count: 'exact', head: true }).like('customer_name', `${RUN}%`)
  const { error } = await createDeposit('staff', { photo: false })
  expect(error?.message).toContain('PHOTO_REQUIRED')
  const { count: after } = await admin().from('deposits').select('id', { count: 'exact', head: true }).like('customer_name', `${RUN}%`)
  expect(after).toBe(before)
})

test('P1-DEP-03 staff of branch A cannot create in branch B', async () => {
  const { error } = await createDeposit('staff', { branch: 'B' })
  expect(error?.message).toContain('FORBIDDEN')
})

test('P1-DEP-04 staff cannot choose a custom expiry', async () => {
  const { error } = await createDeposit('staff', { expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() })
  expect(error?.message).toContain('BAR_ONLY')
})

test('P1-DEP-05 bar confirms levels 100/60/0: in_store, bottle states, remaining 2, LINE outbox', async () => {
  const d = await mustCreate('staff', { qty: 3, customerId })
  await confirmAll(d.id, [100, 60, 0])
  const row = await deposit(d.id)
  expect(row.status).toBe('in_store')
  expect(row.remaining_qty).toBe(2)
  expect(Number(row.remaining_percent)).toBe(80)
  expect(row.confirmed_by).toBe(fixtureIds().users.bar)
  expect((await bottles(d.id)).map((b) => b.status)).toEqual(['sealed', 'opened', 'consumed'])
  const { data: ob } = await admin().from('line_outbox').select('kind, target, locale, status').eq('dedupe_key', `deposit_confirmed:${d.id}`)
  expect(ob).toEqual([{ kind: 'deposit_confirmed', target: LINE_USER, locale: 'en', status: 'queued' }])
})

test('P1-DEP-06 staff cannot confirm', async () => {
  const d = await mustCreate('staff', { qty: 1 })
  const { error } = await dbAs('staff').rpc('confirm_deposit', { p_deposit: d.id, p_levels: [100], p_photo_paths: ['x.jpg'] })
  expect(error?.message).toContain('BAR_ONLY')
  expect((await deposit(d.id)).status).toBe('pending_confirm')
})

test('P1-DEP-07 bar rejects a received deposit → cancelled', async () => {
  const d = await mustCreate('staff', { qty: 1 })
  const { error } = await dbAs('bar').rpc('reject_deposit', { p_deposit: d.id, p_reason: 'ขวดแตก' })
  expect(error).toBeNull()
  const row = await deposit(d.id)
  expect(row.status).toBe('cancelled')
  expect(row.cancel_reason).toBe('ขวดแตก')
})

async function lineRequest(qty = 2) {
  const { branchA } = fixtureIds()
  const { data, error } = await admin().rpc('customer_request_deposit', {
    p_branch: branchA,
    p_customer_id: customerId,
    p_customer_name: `${RUN} LINE request`,
    p_item_name: 'Regency',
    p_quantity: qty,
    p_terms_version: '2026-09-23',
    p_terms_locale: 'en',
  })
  expect(error, error?.message).toBeNull()
  return data as { id: string; code: string }
}

test('P1-DEP-08 bar rejects a LINE request → cancelled (same result)', async () => {
  const r = await lineRequest()
  const row0 = await deposit(r.id)
  expect(row0.status).toBe('requested')
  expect(await bottles(r.id)).toHaveLength(0)
  const { error } = await dbAs('bar').rpc('reject_deposit', { p_deposit: r.id, p_reason: 'ไม่ได้นำขวดมา' })
  expect(error).toBeNull()
  expect((await deposit(r.id)).status).toBe('cancelled')
})

test('P1-DEP-09 staff receives a LINE request with 2 bottles and a photo', async () => {
  const r = await lineRequest(1)
  const { error } = await dbAs('staff').rpc('staff_receive_request', { p_deposit: r.id, p_quantity: 2, p_photo_paths: ['r.jpg'] })
  expect(error, error?.message).toBeNull()
  const row = await deposit(r.id)
  expect(row.status).toBe('pending_confirm')
  expect(row.quantity).toBe(2)
  expect(row.expires_at).not.toBeNull()
  expect(await bottles(r.id)).toHaveLength(2)
})

let wd: { id: string; bottleIds: string[]; withdrawalIds: string[] }

test('P1-DEP-10 staff requests bottle 1 take-home: pending withdrawal, deposit pending_withdrawal, staff-group outbox', async () => {
  const { branchA } = fixtureIds()
  await admin().from('branches').update({ staff_group_id: `C${'f'.repeat(32)}` }).eq('id', branchA)
  const d = await mustCreate('staff', { qty: 2 })
  await confirmAll(d.id, [100, 100])
  const b = await bottles(d.id)
  const { data, error } = await dbAs('staff').rpc('request_withdrawal', { p_deposit: d.id, p_bottle_ids: [b[0].id], p_type: 'take_home' })
  expect(error, error?.message).toBeNull()
  const ids = (data as { withdrawal_ids: string[] }).withdrawal_ids
  expect(ids).toHaveLength(1)
  expect((await deposit(d.id)).status).toBe('pending_withdrawal')
  const { data: w } = await admin().from('withdrawals').select('status, type, requested_by').eq('id', ids[0]).single()
  expect(w).toEqual({ status: 'pending', type: 'take_home', requested_by: fixtureIds().users.staff })
  const { count } = await admin().from('line_outbox').select('id', { count: 'exact', head: true }).eq('dedupe_key', `withdrawal_requested:${ids[0]}`).eq('target_kind', 'group')
  expect(count).toBe(1)
  wd = { id: d.id, bottleIds: b.map((x) => x.id), withdrawalIds: ids }
})

test('P1-DEP-12 staff cannot complete a withdrawal', async () => {
  const { error } = await dbAs('staff').rpc('complete_withdrawals', { p_withdrawal_ids: wd.withdrawalIds })
  expect(error?.message).toContain('BAR_ONLY')
})

test('P1-DEP-11 bar completes it: bottle consumed, remaining 1, back to in_store', async () => {
  const { error } = await dbAs('bar').rpc('complete_withdrawals', { p_withdrawal_ids: wd.withdrawalIds })
  expect(error, error?.message).toBeNull()
  const row = await deposit(wd.id)
  expect(row.status).toBe('in_store')
  expect(row.remaining_qty).toBe(1)
  expect((await bottles(wd.id)).map((b) => b.status)).toEqual(['consumed', 'sealed'])
})

test('P1-DEP-13 bar rejects a withdrawal: rejected, deposit back to in_store', async () => {
  const { data } = await dbAs('staff').rpc('request_withdrawal', { p_deposit: wd.id, p_bottle_ids: [wd.bottleIds[1]], p_type: 'take_home' })
  const ids = (data as { withdrawal_ids: string[] }).withdrawal_ids
  expect((await deposit(wd.id)).status).toBe('pending_withdrawal')
  const { error } = await dbAs('bar').rpc('reject_withdrawal', { p_withdrawal_ids: ids, p_reason: 'ลูกค้ากลับไปแล้ว' })
  expect(error).toBeNull()
  const { data: w } = await admin().from('withdrawals').select('status, reject_reason').eq('id', ids[0]).single()
  expect(w).toEqual({ status: 'rejected', reject_reason: 'ลูกค้ากลับไปแล้ว' })
  expect((await deposit(wd.id)).status).toBe('in_store')
})

test('P1-DEP-14 blocked night: in-store refused, take-home allowed', async () => {
  const { branchA } = fixtureIds()
  await admin().from('branches').update({ withdrawal_blocked_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }).eq('id', branchA)
  const d = await mustCreate('staff', { qty: 2 })
  await confirmAll(d.id, [100, 100])
  const b = await bottles(d.id)
  const inStore = await dbAs('staff').rpc('request_withdrawal', { p_deposit: d.id, p_bottle_ids: [b[0].id], p_type: 'in_store', p_table: 'A1' })
  expect(inStore.error?.message).toContain('WITHDRAW_BLOCKED_DAY')
  const home = await dbAs('staff').rpc('request_withdrawal', { p_deposit: d.id, p_bottle_ids: [b[0].id], p_type: 'take_home' })
  expect(home.error, home.error?.message).toBeNull()
  await admin().from('branches').update({ withdrawal_blocked_days: ['Fri', 'Sat'] }).eq('id', branchA)
})

test('P1-DEP-15 past the collection deadline a withdrawal is refused', async () => {
  const d = await mustCreate('staff', { qty: 1 })
  await confirmAll(d.id, [100])
  await admin().from('deposits').update({ expires_at: new Date(Date.now() - 10 * 86400000).toISOString() }).eq('id', d.id)
  const b = await bottles(d.id)
  const { error } = await dbAs('staff').rpc('request_withdrawal', { p_deposit: d.id, p_bottle_ids: [b[0].id], p_type: 'take_home' })
  expect(error?.message).toContain('DEPOSIT_EXPIRED')
})

test('P1-DEP-16 P1-DEP-17 extend: bar +30 days moves expiry and deadline; staff refused', async () => {
  const d = await mustCreate('staff', { qty: 1 })
  await confirmAll(d.id, [100])
  const before = await deposit(d.id)
  const staff = await dbAs('staff').rpc('extend_deposit', { p_deposit: d.id, p_days: 30 })
  expect(staff.error?.message).toContain('BAR_ONLY')
  const { error } = await dbAs('bar').rpc('extend_deposit', { p_deposit: d.id, p_days: 30 })
  expect(error).toBeNull()
  const after = await deposit(d.id)
  const diff = (new Date(after.expires_at!).getTime() - new Date(before.expires_at!).getTime()) / 86400000
  expect(Math.round(diff)).toBe(30)
  expect(after.collect_deadline_at).not.toBe(before.collect_deadline_at)
  const { count } = await admin().from('deposit_events').select('id', { count: 'exact', head: true }).eq('deposit_id', d.id).eq('action', 'extended')
  expect(count).toBe(1)
})

test('P1-DEP-18 VIP: no expiry, no deadline', async () => {
  const d = await mustCreate('staff', { qty: 1 })
  await confirmAll(d.id, [100])
  const { error } = await dbAs('bar').rpc('set_vip', { p_deposit: d.id, p_vip: true })
  expect(error).toBeNull()
  const row = await deposit(d.id)
  expect(row.is_vip).toBe(true)
  expect(row.expires_at).toBeNull()
  expect(row.collect_deadline_at).toBeNull()
})

const expired: string[] = []

test('P1-DEP-19 P1-DEP-20 expiry job: in_store past deadline expires; one with a pending withdrawal does not', async () => {
  const a = await mustCreate('staff', { qty: 1, customerId })
  const b = await mustCreate('staff', { qty: 1 })
  const held = await mustCreate('staff', { qty: 2 })
  for (const d of [a, b, held]) await confirmAll(d.id, d === held ? [100, 100] : [100])
  const hb = await bottles(held.id)
  await dbAs('staff').rpc('request_withdrawal', { p_deposit: held.id, p_bottle_ids: [hb[0].id], p_type: 'take_home' })
  const past = new Date(Date.now() - 40 * 86400000).toISOString()
  await admin().from('deposits').update({ expires_at: past }).in('id', [a.id, b.id, held.id])
  const { data: n, error } = await admin().rpc('expire_due_deposits')
  expect(error, error?.message).toBeNull()
  expect(n).toBeGreaterThanOrEqual(2)
  expect((await deposit(a.id)).status).toBe('expired')
  expect((await deposit(b.id)).status).toBe('expired')
  expect((await deposit(held.id)).status).toBe('pending_withdrawal')
  const { data: ob } = await admin().from('line_outbox').select('kind').eq('dedupe_key', `expired:${a.id}`)
  expect(ob).toEqual([{ kind: 'expired' }])
  expired.push(a.id, b.id)
})

test('P1-DEP-22 dispose is all-or-nothing: one in_store in the batch refuses the whole batch', async () => {
  const live = await mustCreate('staff', { qty: 1 })
  await confirmAll(live.id, [100])
  const { error } = await dbAs('bar').rpc('dispose_deposits', { p_deposit_ids: [expired[0], live.id] })
  expect(error?.message).toContain('NOT_EXPIRED')
  expect((await deposit(expired[0])).status).toBe('expired')
  expect((await deposit(live.id)).status).toBe('in_store')
})

test('P1-DEP-21 bar disposes two expired deposits', async () => {
  const { data, error } = await dbAs('bar').rpc('dispose_deposits', { p_deposit_ids: expired, p_reason: 'เลยกำหนดรับคืน' })
  expect(error, error?.message).toBeNull()
  expect(data).toEqual({ count: 2 })
  for (const id of expired) {
    const row = await deposit(id)
    expect(row.status).toBe('disposed')
    expect(row.disposed_by).toBe(fixtureIds().users.bar)
  }
})

test('P1-DEP-23 no direct writes: bar update/insert/delete on deposits is refused', async () => {
  const d = await mustCreate('staff', { qty: 1 })
  const upd = await dbAs('bar').from('deposits').update({ status: 'withdrawn' }).eq('id', d.id).select('id')
  expect(upd.error?.code).toBe('42501')
  const del = await dbAs('owner').from('deposits').delete().eq('id', d.id).select('id')
  expect(del.error?.code).toBe('42501')
  expect((await deposit(d.id)).status).toBe('pending_confirm')
})

test('P1-DEP-24 P1-DEP-25 collection deadline: Fri/Sat move to Sunday night, weekday is the next 04:00', async () => {
  const d = await mustCreate('staff', { qty: 1 })
  // expiry on Friday 2026-10-02 (Bangkok) → last night Sunday 04 Oct → Mon 05 Oct 04:00 +07
  await admin().from('deposits').update({ expires_at: '2026-10-02T15:00:00+07:00' }).eq('id', d.id)
  expect(new Date((await deposit(d.id)).collect_deadline_at!).toISOString()).toBe('2026-10-04T21:00:00.000Z')
  // expiry on Wednesday 2026-09-30 → Thu 01 Oct 04:00 +07
  await admin().from('deposits').update({ expires_at: '2026-09-30T20:00:00+07:00' }).eq('id', d.id)
  expect(new Date((await deposit(d.id)).collect_deadline_at!).toISOString()).toBe('2026-09-30T21:00:00.000Z')
})

test('P1-DEP-26 staff of branch A sees none of branch B deposits', async () => {
  const b = await mustCreate('staffB', { qty: 1, branch: 'B' })
  const { data } = await dbAs('staff').from('deposits').select('id, branch_id').like('customer_name', `${RUN}%`).range(0, 999)
  const ids = (data ?? []).map((x) => x.id)
  expect(ids.length).toBeGreaterThan(0)
  expect(ids).not.toContain(b.id)
  expect((data ?? []).every((x) => x.branch_id === fixtureIds().branchA)).toBe(true)
  const { data: ev } = await dbAs('staff').from('deposit_events').select('id').eq('deposit_id', b.id)
  expect(ev).toEqual([])
})

test('P1-DEP-27 twelve codes back-to-back are unique and well-formed', async () => {
  const codes: string[] = []
  for (let i = 0; i < 12; i++) codes.push((await mustCreate('staff', { qty: 1 })).code)
  expect(new Set(codes).size).toBe(12)
  for (const c of codes) expect(c).toMatch(/^DEP-ZTA-[A-HJ-NP-Z2-9]{5}$/)
})
