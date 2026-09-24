import { expect, test } from '@playwright/test'
import { addDays, businessNight } from '../../src/lib/date'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'

/**
 * P1-BK-23 … 31 — customers pick their own table (R-036). The branch's table_choice, the table's
 * and its zone's customer switches, the closed nights and the party size decide what a customer may
 * take; staff are never limited by them. Own zones and tables at fixture branch A, removed after.
 */
test.describe.configure({ mode: 'serial' })

const admin = () => adminDb()
const RUN = `E2ETC-${Date.now().toString(36)}`
const SUFFIX = RUN.slice(-4)
const NIGHT = addDays(businessNight(), 4)
const LINE_A = `U${'7c01'.repeat(8)}`
const LINE_B = `U${'7c02'.repeat(8)}`
const T = { one: '', two: '', off: '', zoneOff: '', big: '' }
let zoneOpen = ''
let zoneClosed = ''
let custA = ''
let custB = ''

const DEFAULTS = {
  line_enabled: true, auto_confirm: false, advance_days: 14, cutoff_time: '18:00', slot_start: '19:00', slot_end: '23:00',
  slot_minutes: 30, max_bookings_per_night: null as number | null, party_min: 1, party_max: 12, no_show_minutes: 30,
  customer_cancel_hours: 2, closed_weekdays: [] as number[],
}

async function choice(value: 'shop' | 'customer') {
  const { branchA } = fixtureIds()
  const { error } = await admin().from('booking_settings').update({ ...DEFAULTS, table_choice: value }).eq('branch_id', branchA)
  expect(error, error?.message).toBeNull()
}

/** a customer booking (service role, source line) */
function book(table: string | null, patch: Record<string, unknown> = {}, customer = custA) {
  const { branchA } = fixtureIds()
  return admin().rpc('create_booking', {
    p_branch: branchA, p_night: NIGHT, p_slot: '20:30', p_party: 4, p_name: `${RUN} ลูกค้า`, p_customer_id: customer,
    ...(table ? { p_table: table } : {}), ...patch,
  } as never)
}
const message = (r: { error: { message: string } | null }) => r.error?.message ?? ''

async function table(zone: string, label: string, seats: [number, number], customerBookable = true) {
  const { branchA } = fixtureIds()
  const { data, error } = await admin()
    .from('tables')
    .insert({ branch_id: branchA, zone_id: zone, label: `${label}-${SUFFIX}`, seats_min: seats[0], seats_max: seats[1], customer_bookable: customerBookable })
    .select('id')
    .single()
  expect(error, error?.message).toBeNull()
  return data!.id
}

test.beforeAll(async () => {
  const { branchA } = fixtureIds()
  for (const [line, set] of [[LINE_A, (id: string) => (custA = id)], [LINE_B, (id: string) => (custB = id)]] as const) {
    const { data, error } = await admin().from('customers').upsert({ line_user_id: line, display_name: `${RUN} LINE`, locale: 'th' }, { onConflict: 'line_user_id' }).select('id').single()
    expect(error, error?.message).toBeNull()
    set(data!.id)
  }
  const z1 = await admin().from('table_zones').insert({ branch_id: branchA, name: `${RUN} ในร้าน`, sort: 90 }).select('id').single()
  const z2 = await admin().from('table_zones').insert({ branch_id: branchA, name: `${RUN} VIP`, sort: 91, customer_bookable: false }).select('id').single()
  zoneOpen = z1.data!.id
  zoneClosed = z2.data!.id
  T.one = await table(zoneOpen, 'TC1', [2, 6])
  T.two = await table(zoneOpen, 'TC2', [2, 6])
  T.off = await table(zoneOpen, 'TCX', [2, 6], false)
  T.zoneOff = await table(zoneClosed, 'TCZ', [2, 6])
  T.big = await table(zoneOpen, 'TC8', [6, 8])
})

test.afterAll(async () => {
  await admin().from('bookings').delete().like('name', `${RUN}%`)
  await admin().from('tables').delete().in('id', Object.values(T).filter(Boolean))
  await admin().from('table_zones').delete().in('id', [zoneOpen, zoneClosed].filter(Boolean))
  await admin().from('customers').delete().in('line_user_id', [LINE_A, LINE_B])
  await choice('shop')
})

test('P1-BK-23 a customer may not name a table while the shop seats its guests', async () => {
  await choice('shop')
  expect(message(await book(T.one))).toContain('FORBIDDEN')
})

test('P1-BK-24 when customers pick, a customer booking must name a table', async () => {
  await choice('customer')
  expect(message(await book(null))).toContain('table_required')
})

test('P1-BK-25 a table switched off for customers, or in a zone closed to them, is not theirs to take', async () => {
  expect(message(await book(T.off))).toContain('table_not_bookable')
  expect(message(await book(T.zoneOff))).toContain('table_not_bookable')
})

test('P1-BK-26 a table closed on a night refuses that night only', async () => {
  const { branchA } = fixtureIds()
  const { error } = await admin().from('table_blocks').insert({ branch_id: branchA, table_id: T.one, night: NIGHT })
  expect(error, error?.message).toBeNull()
  expect(message(await book(T.one))).toContain('table_not_bookable')
  const next = await book(T.one, { p_night: addDays(NIGHT, 1) })
  expect(next.error, next.error?.message).toBeNull()
})

test('P1-BK-27 the party must fit the table', async () => {
  expect(message(await book(T.big, { p_party: 4 }))).toContain('table_seats') // 6–8 seats
  expect(message(await book(T.two, { p_party: 7 }))).toContain('table_seats') // 2–6 seats
})

test('P1-BK-28 a free table: the booking holds it in the table\'s zone; the next customer is refused', async () => {
  const { branchA } = fixtureIds()
  const r = await book(T.two, { p_zone: zoneClosed }) // a zone sent alongside is ignored — the table decides
  expect(r.error, r.error?.message).toBeNull()
  const made = r.data as unknown as { id: string; status: string }
  expect(made.status).toBe('pending')
  const { data: row } = await admin().from('bookings').select('table_id, zone_id, source').eq('id', made.id).single()
  expect(row).toEqual({ table_id: T.two, zone_id: zoneOpen, source: 'line' })
  expect(message(await book(T.two, {}, custB))).toContain('table_taken')
  void branchA
})

test('P1-BK-29 the night\'s plan: free / taken / blocked per table, no names; other-branch staff refused', async () => {
  const { branchA } = fixtureIds()
  type Plan = { table_choice: string; zones: { id: string; tables: { id: string; state: string }[] }[] }
  const states = (p: Plan) => Object.fromEntries(p.zones.flatMap((z) => z.tables).map((t) => [t.id, t.state]))
  const service = await admin().rpc('table_availability', { p_branch: branchA, p_night: NIGHT })
  expect(service.error, service.error?.message).toBeNull()
  const plan = service.data as unknown as Plan
  expect(plan.table_choice).toBe('customer')
  expect(states(plan)).toMatchObject({ [T.one]: 'blocked', [T.two]: 'taken', [T.off]: 'blocked', [T.zoneOff]: 'blocked', [T.big]: 'free' })
  // never who holds a table: no booking name anywhere, and a table carries only these fields
  expect(JSON.stringify(plan)).not.toContain(`${RUN} ลูกค้า`)
  for (const x of plan.zones.flatMap((z) => z.tables)) expect(Object.keys(x).sort()).toEqual(['id', 'label', 'seats_max', 'seats_min', 'shape', 'state'])
  // the next night: the closed night has passed on T.one, which a booking now holds (P1-BK-26)
  const next = (await admin().rpc('table_availability', { p_branch: branchA, p_night: addDays(NIGHT, 1) })).data as unknown as Plan
  expect(states(next)).toMatchObject({ [T.one]: 'taken', [T.two]: 'free' })
  const staff = await dbAs('staff').rpc('table_availability', { p_branch: branchA, p_night: NIGHT })
  expect(staff.error, staff.error?.message).toBeNull()
  expect(message(await dbAs('staffB').rpc('table_availability', { p_branch: branchA, p_night: NIGHT }))).toContain('FORBIDDEN')
})

test('P1-BK-30 closed nights: owner writes, staff and bar cannot; a table of another branch is refused', async () => {
  const { branchA, branchB } = fixtureIds()
  const night = addDays(NIGHT, 2)
  const own = await dbAs('owner').from('table_blocks').insert({ branch_id: branchA, table_id: T.big, night }).select('id').single()
  expect(own.error, own.error?.message).toBeNull()
  for (const role of ['staff', 'bar'] as const) {
    const r = await dbAs(role).from('table_blocks').insert({ branch_id: branchA, table_id: T.big, night: addDays(night, 1) })
    expect(r.error, role).not.toBeNull()
  }
  const del = await dbAs('owner').from('table_blocks').delete().eq('id', own.data!.id).select('id')
  expect(del.data).toHaveLength(1)
  expect(message(await admin().from('table_blocks').insert({ branch_id: branchB, table_id: T.big, night }))).toContain('TABLE_OTHER_BRANCH')
})

test('P1-BK-31 staff bookings and table assignment are not limited by the customer switches', async () => {
  const { branchA } = fixtureIds()
  const r = await dbAs('staff').rpc('create_booking', { p_branch: branchA, p_night: NIGHT, p_slot: '21:00', p_party: 2, p_name: `${RUN} staff`, p_table: T.off } as never)
  expect(r.error, r.error?.message).toBeNull()
  const id = (r.data as unknown as { id: string }).id
  const moved = await dbAs('bar').rpc('assign_table', { p_booking: id, p_table: T.zoneOff })
  expect(moved.error, moved.error?.message).toBeNull()
})
