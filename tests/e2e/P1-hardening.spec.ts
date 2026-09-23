import { expect, test } from '@playwright/test'
import { addDays, businessNight } from '../../src/lib/date'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { RUN, bottles, cleanupRun, confirmAll, deposit, mustCreate, photo } from './fixtures/deposits'

test.describe.configure({ mode: 'serial' })

const admin = () => adminDb()
const LINE_USER = `U${'5ec0'.repeat(8)}`
let customerId = ''

test.beforeAll(async () => {
  const c = await admin().from('customers').upsert({ line_user_id: LINE_USER, display_name: `${RUN} sec`, locale: 'th' }, { onConflict: 'line_user_id' }).select('id').single()
  customerId = c.data!.id
})

test.afterAll(async () => {
  await cleanupRun()
  await admin().from('bookings').delete().eq('customer_id', customerId)
  await admin().from('customers').delete().eq('id', customerId)
})

test('P1-SEC-01 linking needs the receipt token and the right branch — the label code is not enough', async () => {
  const { branchA, branchB } = fixtureIds()
  const d = await mustCreate('staff', { qty: 1 })
  const row = await deposit(d.id)
  const byCode = await admin().rpc('link_deposit_customer', { p_branch: branchA, p_token: row.code, p_customer_id: customerId })
  expect(byCode.error?.message).toContain('NOT_FOUND')
  const otherBranch = await admin().rpc('link_deposit_customer', { p_branch: branchB, p_token: row.link_token, p_customer_id: customerId })
  expect(otherBranch.error?.message).toContain('NOT_FOUND')
  expect((await deposit(d.id)).customer_id).toBeNull()
  const ok = await admin().rpc('link_deposit_customer', { p_branch: branchA, p_token: row.link_token, p_customer_id: customerId })
  expect(ok.error, ok.error?.message).toBeNull()
  expect((await deposit(d.id)).customer_id).toBe(customerId)
  expect((await dbAs('owner').rpc('link_deposit_customer', { p_branch: branchA, p_token: row.link_token, p_customer_id: customerId })).error?.code).toBe('42501')
})

test('P1-SEC-02 staff cannot attach a customer to a deposit or a booking', async () => {
  const { branchA } = fixtureIds()
  const dep = await dbAs('staff').rpc('create_deposit', {
    p_branch: branchA, p_customer_name: `${RUN} x`, p_item_name: 'Regency', p_quantity: 1, p_photo_paths: [await photo()], p_customer_id: customerId,
  })
  expect(dep.error?.message).toContain('FORBIDDEN')
  const bk = await dbAs('staff').rpc('create_booking', {
    p_branch: branchA, p_night: addDays(businessNight(), 2), p_slot: '20:00', p_party: 2, p_name: `${RUN} x`, p_customer_id: customerId,
  } as never)
  expect(bk.error?.message).toContain('FORBIDDEN')
  const { count } = await admin().from('deposits').select('id', { count: 'exact', head: true }).eq('customer_name', `${RUN} x`)
  expect(count).toBe(0)
})

test('P1-SEC-03 photo paths must be stored objects in the deposit’s own branch folder', async () => {
  const { branchA } = fixtureIds()
  const base = { p_branch: branchA, p_customer_name: `${RUN} photo`, p_item_name: 'Regency', p_quantity: 1 }
  const fake = await dbAs('staff').rpc('create_deposit', { ...base, p_photo_paths: [`${branchA}/nope/missing.jpg`] })
  expect(fake.error?.message).toContain('PHOTO_REQUIRED')
  const foreign = await dbAs('staff').rpc('create_deposit', { ...base, p_photo_paths: [await photo('B')] })
  expect(foreign.error?.message).toContain('PHOTO_REQUIRED')
  const good = await dbAs('staff').rpc('create_deposit', { ...base, p_photo_paths: [await photo('A')] })
  expect(good.error, good.error?.message).toBeNull()
})

test('P1-SEC-04 a customer request naming another branch is refused', async () => {
  const { branchA, branchB } = fixtureIds()
  const d = await mustCreate('staff', { qty: 1, customerId })
  await confirmAll(d.id, [100])
  const b = await bottles(d.id)
  const wrong = await admin().rpc('request_withdrawal', { p_deposit: d.id, p_bottle_ids: [b[0].id], p_type: 'take_home', p_customer_id: customerId, p_branch: branchB })
  expect(wrong.error?.message).toContain('NOT_YOURS')
  const right = await admin().rpc('request_withdrawal', { p_deposit: d.id, p_bottle_ids: [b[0].id], p_type: 'take_home', p_customer_id: customerId, p_branch: branchA })
  expect(right.error, right.error?.message).toBeNull()
  const bk = await admin().rpc('create_booking', {
    p_branch: branchA, p_night: addDays(businessNight(), 5), p_slot: '20:00', p_party: 2, p_name: `${RUN} c`, p_customer_id: customerId,
  } as never)
  expect(bk.error, bk.error?.message).toBeNull()
  const id = (bk.data as { id: string }).id
  const cancelWrong = await admin().rpc('cancel_booking', { p_booking: id, p_customer_id: customerId, p_branch: branchB } as never)
  expect(cancelWrong.error?.message).toContain('NOT_YOURS')
  const { data } = await admin().from('bookings').select('status').eq('id', id).single()
  expect(data?.status).not.toBe('cancelled')
})

test('P1-SEC-05 expiry guard: staff RPC refused, bar RPC allowed', async () => {
  const d = await mustCreate('staff', { qty: 1 })
  await confirmAll(d.id, [100])
  expect((await dbAs('staff').rpc('extend_deposit', { p_deposit: d.id, p_days: 5 })).error?.message).toContain('BAR_ONLY')
  expect((await dbAs('bar').rpc('extend_deposit', { p_deposit: d.id, p_days: 5 })).error).toBeNull()
})
