import { expect, test } from '@playwright/test'
import { addDays, bangkokParts, businessNight, weekdayIndex } from '../../src/lib/date'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'

/**
 * P1-03 booking rules and transitions at the database. The fixture branches hold no real
 * bookings, so every run starts by clearing ZTA/ZTB bookings (fixture branches only).
 */
test.describe.configure({ mode: 'serial' })

const admin = () => adminDb()
const TODAY = businessNight()
const NIGHT = addDays(TODAY, 3)
const LINE_USER = `U${'b00c'.repeat(8)}`
let customerId = ''
let zoneOpen = ''
let zoneStaff = ''
let tableA1 = ''

const DEFAULTS = {
  line_enabled: true,
  auto_confirm: false,
  advance_days: 14,
  cutoff_time: '18:00',
  slot_start: '19:00',
  slot_end: '23:00',
  slot_minutes: 30,
  max_bookings_per_night: null as number | null,
  party_min: 1,
  party_max: 12,
  no_show_minutes: 30,
  customer_cancel_hours: 2,
  closed_weekdays: [] as number[],
}

async function settings(patch: Partial<typeof DEFAULTS>) {
  const { branchA } = fixtureIds()
  const { error } = await admin().from('booking_settings').update({ ...DEFAULTS, ...patch }).eq('branch_id', branchA)
  expect(error, error?.message).toBeNull()
}

async function clearBookings() {
  const { branchA, branchB } = fixtureIds()
  await admin().from('bookings').delete().in('branch_id', [branchA, branchB])
  await admin().from('booking_blackouts').delete().in('branch_id', [branchA, branchB])
}

/** customer booking (service role, source line) */
async function lineBook(patch: Record<string, unknown> = {}) {
  const { branchA } = fixtureIds()
  return admin().rpc('create_booking', {
    p_branch: branchA, p_night: NIGHT, p_slot: '20:30', p_party: 4, p_name: 'E2E ลูกค้า', p_phone: '081-000-0000',
    p_zone: zoneOpen, p_customer_id: customerId, ...patch,
  } as never)
}

/** staff booking (authenticated, source staff) */
async function staffBook(role: 'staff' | 'bar' | 'staffB' = 'staff', patch: Record<string, unknown> = {}) {
  const { branchA, branchB } = fixtureIds()
  return dbAs(role).rpc('create_booking', {
    p_branch: role === 'staffB' ? branchB : branchA, p_night: TODAY, p_slot: '21:00', p_party: 2, p_name: 'E2E โทรจอง', ...patch,
  } as never)
}

const ok = <T,>(r: { data: T; error: { message: string } | null }) => {
  expect(r.error, r.error?.message).toBeNull()
  return r.data as unknown as { id: string; code: string; status: string; qr_token: string }
}

test.beforeAll(async () => {
  const { branchA } = fixtureIds()
  await clearBookings()
  await settings({})
  const c = await admin().from('customers').upsert({ line_user_id: LINE_USER, display_name: 'E2E-booking LINE', locale: 'th' }, { onConflict: 'line_user_id' }).select('id').single()
  customerId = c.data!.id
  await admin().from('tables').delete().eq('branch_id', branchA)
  await admin().from('table_zones').delete().eq('branch_id', branchA)
  const z1 = await admin().from('table_zones').insert({ branch_id: branchA, name: 'หน้าเวที', sort: 1 }).select('id').single()
  const z2 = await admin().from('table_zones').insert({ branch_id: branchA, name: 'VIP', sort: 2, customer_bookable: false }).select('id').single()
  zoneOpen = z1.data!.id
  zoneStaff = z2.data!.id
  const t = await admin().from('tables').insert({ branch_id: branchA, zone_id: zoneOpen, label: 'A1', seats_min: 2, seats_max: 6 }).select('id').single()
  tableA1 = t.data!.id
})

test.afterAll(async () => {
  await clearBookings()
  await settings({})
  await admin().from('customers').delete().eq('line_user_id', LINE_USER)
})

test('P1-BK-01 P1-BK-02 LINE booking: pending, BK-MMDD-001 then -002, 32-char QR token, staff-group outbox', async () => {
  const { branchA } = fixtureIds()
  await admin().from('branches').update({ staff_group_id: `C${'a'.repeat(32)}` }).eq('id', branchA)
  const mmdd = NIGHT.slice(5, 7) + NIGHT.slice(8, 10)
  const a = ok(await lineBook())
  expect(a.status).toBe('pending')
  expect(a.code).toBe(`BK-${mmdd}-001`)
  expect(a.qr_token).toMatch(/^[0-9a-f]{32}$/)
  const b = ok(await lineBook({ p_slot: '21:00' }))
  expect(b.code).toBe(`BK-${mmdd}-002`)
  const { count } = await admin().from('line_outbox').select('id', { count: 'exact', head: true }).eq('dedupe_key', `booking_new:${a.id}`)
  expect(count).toBe(1)
  await admin().from('line_outbox').delete().in('payload->>booking_id', [a.id, b.id])
  await admin().from('branches').update({ staff_group_id: null }).eq('id', branchA)
})

test('P1-BK-03 auto-confirm on → confirmed', async () => {
  await settings({ auto_confirm: true })
  expect(ok(await lineBook({ p_slot: '19:00' })).status).toBe('confirmed')
  await settings({})
})

test('P1-BK-04 closed weekday', async () => {
  await settings({ closed_weekdays: [weekdayIndex(NIGHT)] })
  expect((await lineBook()).error?.message).toContain('closed_weekday')
  await settings({})
})

test('P1-BK-05 blackout night', async () => {
  const { branchA } = fixtureIds()
  await admin().from('booking_blackouts').insert({ branch_id: branchA, night: NIGHT, reason: 'ปิดร้าน' })
  expect((await lineBook()).error?.message).toContain('blackout')
  await admin().from('booking_blackouts').delete().eq('branch_id', branchA).eq('night', NIGHT)
})

test('P1-BK-06 beyond advance_days', async () => {
  expect((await lineBook({ p_night: addDays(TODAY, 15) })).error?.message).toContain('too_far')
})

test('P1-BK-07 LINE after the cutoff is refused, staff still books tonight', async () => {
  await settings({ cutoff_time: '06:00' })
  const r = await lineBook({ p_night: TODAY, p_slot: '22:00' })
  const hour = bangkokParts().hour
  if (hour >= 6) expect(r.error?.message).toContain('cutoff')
  else expect(r.error).toBeNull() // 00:00–05:59 is still the previous night's service
  expect(ok(await staffBook('staff', { p_slot: '22:30' })).status).toBe('confirmed')
  await settings({})
})

test('P1-BK-08 slot outside the 30-minute grid', async () => {
  expect((await lineBook({ p_slot: '19:15' })).error?.message).toContain('bad_slot')
})

test('P1-BK-09 party size bounds', async () => {
  expect((await lineBook({ p_party: 0 })).error?.message).toContain('party_size')
  expect((await lineBook({ p_party: 13 })).error?.message).toContain('party_size')
})

test('P1-BK-10 capacity: full at the max, cancelled ones do not count', async () => {
  await clearBookings()
  await settings({ max_bookings_per_night: 2 })
  const a = ok(await lineBook({ p_slot: '19:00' }))
  ok(await lineBook({ p_slot: '19:30' }))
  expect((await lineBook({ p_slot: '20:00' })).error?.message).toContain('full')
  ok(await admin().rpc('cancel_booking', { p_booking: a.id, p_customer_id: customerId } as never))
  expect((await lineBook({ p_slot: '20:00' })).error).toBeNull()
  await settings({})
})

test('P1-BK-11 LINE booking disabled', async () => {
  await settings({ line_enabled: false })
  expect((await lineBook()).error?.message).toContain('line_disabled')
  expect((await staffBook()).error).toBeNull()
  await settings({})
})

test('P1-BK-12 staff-only zone refused for LINE', async () => {
  expect((await lineBook({ p_zone: zoneStaff })).error?.message).toContain('zone_not_bookable')
})

let pendingId = ''
test('P1-BK-13 confirm: staff refused, bar confirms', async () => {
  pendingId = ok(await lineBook({ p_slot: '22:30' })).id
  expect((await dbAs('staff').rpc('confirm_booking', { p_booking: pendingId } as never)).error?.message).toContain('BAR_ONLY')
  ok(await dbAs('bar').rpc('confirm_booking', { p_booking: pendingId } as never))
  const { data } = await admin().from('bookings').select('status, confirmed_by').eq('id', pendingId).single()
  expect(data).toEqual({ status: 'confirmed', confirmed_by: fixtureIds().users.bar })
})

test('P1-BK-14 a table can hold one live booking per night', async () => {
  ok(await dbAs('bar').rpc('assign_table', { p_booking: pendingId, p_table: tableA1 } as never))
  const other = ok(await lineBook({ p_slot: '23:00' }))
  expect((await dbAs('bar').rpc('assign_table', { p_booking: other.id, p_table: tableA1 } as never)).error?.message).toContain('table_taken')
})

let arrivedId = ''
test('P1-BK-15 check-in by QR token → arrived', async () => {
  const b = ok(await staffBook('staff', { p_slot: '20:00' }))
  const { data, error } = await dbAs('staff').rpc('check_in_booking', { p_branch: fixtureIds().branchA, p_ref: b.qr_token } as never)
  expect(error, error?.message).toBeNull()
  expect(data).toMatchObject({ status: 'arrived', already: false })
  const { data: row } = await admin().from('bookings').select('status, checked_in_by, arrived_at').eq('id', b.id).single()
  expect(row?.status).toBe('arrived')
  expect(row?.checked_in_by).toBe(fixtureIds().users.staff)
  expect(row?.arrived_at).not.toBeNull()
  arrivedId = b.id
})

test('P1-BK-16 staff of branch A cannot check in a branch B booking', async () => {
  const b = ok(await staffBook('staffB', { p_slot: '20:00' }))
  const r = await dbAs('staff').rpc('check_in_booking', { p_branch: fixtureIds().branchA, p_ref: b.qr_token } as never)
  expect(r.error?.message).toContain('FORBIDDEN')
  const { data } = await admin().from('bookings').select('status').eq('id', b.id).single()
  expect(data?.status).toBe('confirmed')
})

test('P1-BK-17 customer cancels inside the window; too late once the window has passed', async () => {
  const early = ok(await lineBook({ p_slot: '19:30', p_night: addDays(TODAY, 4) }))
  ok(await admin().rpc('cancel_booking', { p_booking: early.id, p_customer_id: customerId } as never))
  const { data } = await admin().from('bookings').select('status, cancelled_by_customer').eq('id', early.id).single()
  expect(data).toEqual({ status: 'cancelled', cancelled_by_customer: true })
  const late = ok(await lineBook({ p_slot: '20:00', p_night: addDays(TODAY, 4) }))
  await admin().from('bookings').update({ night: addDays(TODAY, -1) }).eq('id', late.id)
  expect((await admin().rpc('cancel_booking', { p_booking: late.id, p_customer_id: customerId } as never)).error?.message).toContain('cancel_too_late')
  const other = ok(await lineBook({ p_slot: '21:30', p_night: addDays(TODAY, 4) }))
  expect((await admin().rpc('cancel_booking', { p_booking: other.id, p_customer_id: '00000000-0000-0000-0000-000000000000' } as never)).error?.message).toContain('NOT_YOURS')
})

test('P1-BK-18 no-show job: past confirmed/pending → no_show, arrived untouched', async () => {
  const c = ok(await staffBook('staff', { p_slot: '19:00', p_night: addDays(TODAY, 1) }))
  const p = ok(await lineBook({ p_slot: '19:00', p_night: addDays(TODAY, 1) }))
  const yesterday = addDays(TODAY, -1)
  await admin().from('bookings').update({ night: yesterday }).in('id', [c.id, p.id])
  await admin().from('bookings').update({ night: yesterday }).eq('id', arrivedId)
  const { error } = await admin().rpc('mark_no_shows')
  expect(error, error?.message).toBeNull()
  const { data } = await admin().from('bookings').select('id, status').in('id', [c.id, p.id, arrivedId])
  const st = Object.fromEntries((data ?? []).map((r) => [r.id, r.status]))
  expect(st[c.id]).toBe('no_show')
  expect(st[p.id]).toBe('no_show')
  expect(st[arrivedId]).toBe('arrived')
})

test('P1-BK-19 availability: 7 nights, closed weekday and blackout flagged, slots listed', async () => {
  const { branchA } = fixtureIds()
  const closedNight = addDays(TODAY, 2)
  const blackNight = addDays(TODAY, 5)
  await settings({ closed_weekdays: [weekdayIndex(closedNight)] })
  await admin().from('booking_blackouts').insert({ branch_id: branchA, night: blackNight, reason: 'วันหยุด' })
  const { data, error } = await dbAs('staff').rpc('booking_availability', { p_branch: branchA, p_from: TODAY, p_to: addDays(TODAY, 6) } as never)
  expect(error, error?.message).toBeNull()
  const nights = (data as { nights: { night: string; closed: boolean; reason: string | null; slots: string[]; blackout_reason: string | null }[] }).nights
  expect(nights).toHaveLength(7)
  const by = Object.fromEntries(nights.map((n) => [n.night, n]))
  expect(by[closedNight]).toMatchObject({ closed: true, reason: 'closed_weekday' })
  expect(by[blackNight]).toMatchObject({ closed: true, reason: 'blackout', blackout_reason: 'วันหยุด' })
  expect(by[addDays(TODAY, 1)].slots).toEqual(['19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30', '23:00'])
  const denied = await dbAs('staffB').rpc('booking_availability', { p_branch: branchA, p_from: TODAY, p_to: TODAY } as never)
  expect(denied.error?.message).toContain('FORBIDDEN')
  await settings({})
})

test('P1-BK-20 an arrived booking cannot be cancelled', async () => {
  const r = await dbAs('bar').rpc('cancel_booking', { p_booking: arrivedId } as never)
  expect(r.error?.message).toContain('BAD_STATE')
  const { data } = await admin().from('bookings').select('status').eq('id', arrivedId).single()
  expect(data?.status).toBe('arrived')
})
