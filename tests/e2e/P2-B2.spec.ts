import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { addDays, businessNight } from '../../src/lib/date'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { clearBookings, resetSettings, setupZonesAndTables, teardownZonesAndTables, type ZoneTableSet } from './fixtures/p2b-bookings'

test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const admin = () => adminDb()
const NIGHT = addDays(businessNight(), 6)
const LINE_USER = `U${'2b2'.repeat(10)}2b`
let branchA = ''
let zt: ZoneTableSet
let customerId = ''
let seq = 0

async function insertBooking(over: {
  night: string
  slotTime: string
  status?: 'pending' | 'confirmed' | 'arrived'
  tableId?: string | null
  zoneId?: string | null
  name?: string
  phone?: string | null
  customerId?: string | null
  party?: number
  source?: 'line' | 'staff'
}) {
  seq += 1
  const mmdd = over.night.slice(5, 7) + over.night.slice(8, 10)
  const { data, error } = await admin()
    .from('bookings')
    .insert({
      branch_id: branchA,
      code: `BK-${mmdd}-${String(800 + seq).slice(0, 3)}`,
      night: over.night,
      slot_time: over.slotTime,
      party_size: over.party ?? 4,
      zone_id: over.zoneId ?? null,
      table_id: over.tableId ?? null,
      customer_id: over.customerId === undefined ? customerId : over.customerId,
      name: over.name ?? 'P2B2 ลูกค้า',
      phone: over.phone ?? null,
      source: over.source ?? 'line',
      status: over.status ?? 'confirmed',
    })
    .select('id, code, qr_token')
    .single()
  if (error) throw new Error(`insertBooking: ${error.message}`)
  return data
}

test.beforeAll(async () => {
  const ids = fixtureIds()
  branchA = ids.branchA
  await clearBookings(admin(), [branchA])
  await resetSettings(admin(), branchA)
  zt = await setupZonesAndTables(admin(), branchA)
  const c = await admin().from('customers').upsert({ line_user_id: LINE_USER, display_name: 'P2B2 LINE', locale: 'th' }, { onConflict: 'line_user_id' }).select('id').single()
  if (c.error || !c.data) throw new Error(`customer fixture: ${c.error?.message}`)
  customerId = c.data.id
})

test.afterAll(async () => {
  await clearBookings(admin(), [branchA])
  await resetSettings(admin(), branchA)
  await teardownZonesAndTables(admin(), branchA)
  await admin().from('customers').delete().eq('line_user_id', LINE_USER)
})

test.describe('scan + sheet', () => {
  test.use({ storageState: as('bar') })

  test('P2-B2-01 P2-B2-03 scan by code shows the sheet with the gold deposits box', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    await admin().from('deposits').delete().eq('branch_id', branchA).eq('customer_id', customerId)
    const dep = await admin()
      .from('deposits')
      .insert({
        branch_id: branchA, code: 'DEP-ZZQ-P2B2A', customer_id: customerId, customer_name: 'P2B2 ลูกค้า',
        item_name: 'P2B2 Whisky', quantity: 1, remaining_qty: 1, remaining_percent: 65, status: 'in_store', source: 'staff',
        // deposits.link_code defaults to private.new_link_code(), which service_role
        // currently has no EXECUTE grant on — supply it explicitly to sidestep that
        // (unrelated DB grant, outside this worker's write set; see final report)
        link_code: 'P2B2AA',
      } as never)
      .select('id, code')
      .single()
    expect(dep.error, dep.error?.message).toBeNull()

    const b = await insertBooking({ night: NIGHT, slotTime: '20:00', status: 'confirmed', phone: '081-234-5678' })
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(b.code)
    await page.getByRole('button', { name: 'ค้นหา' }).click()

    const sheet = page.getByTestId('booking-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(b.code)
    await expect(sheet).toContainText('P2B2 ลูกค้า')
    await expect(sheet).toContainText('081-234-5678')
    await expect(page.getByTestId('booking-deposits-box')).toContainText('มีเหล้าฝาก 1 รายการ')
    await expect(page.getByTestId('booking-deposits-box')).toContainText('P2B2 Whisky')
    await admin().from('deposits').delete().eq('id', dep.data!.id)
  })

  test('P2-B2-02 ลูกค้ามาแล้ว checks the booking in', async ({ page }) => {
    // check_in_booking only accepts tonight's business night (WRONG_NIGHT otherwise, see P2-B2-05)
    const tonight = businessNight()
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: tonight, slotTime: '20:30', status: 'confirmed', tableId: zt.tableA1, zoneId: zt.zoneStage })
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(b.code)
    await page.getByRole('button', { name: 'ค้นหา' }).click()
    const checkInBtn = page.getByTestId('check-in-button')
    // run after 20:30 Bangkok the same button reads "ลูกค้ามาแล้ว (มาสาย)" — the clock, not the flow
    await expect(checkInBtn).toHaveText(/^ลูกค้ามาแล้ว/)
    await checkInBtn.click()
    await expect(checkInBtn).toHaveText('เช็กอินแล้ว')
    await expect(checkInBtn).toBeDisabled()
    const { data } = await admin().from('bookings').select('status').eq('id', b.id).single()
    expect(data?.status).toBe('arrived')

    await page.goto(`/bookings?night=${tonight}&view=plan`)
    await expect(page.locator('.t-cell[data-state="arrived"]')).toHaveCount(1)
  })

  test('P2-B2-04 typing a table label with a live booking tonight opens its sheet', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: businessNight(), slotTime: '21:00', status: 'confirmed', tableId: zt.tableA2, zoneId: zt.zoneStage })
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill('PA2')
    await page.getByRole('button', { name: 'ค้นหา' }).click()
    await expect(page.getByTestId('scan-result-booking')).toContainText(b.code)
  })

  test('P2-B2-05 a booking of another night offers no ลูกค้ามาแล้ว — a note says when; the RPC still refuses', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const other = addDays(NIGHT, 1)
    const b = await insertBooking({ night: other, slotTime: '20:00', status: 'confirmed' })
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(b.code)
    await page.getByRole('button', { name: 'ค้นหา' }).click()
    await expect(page.getByTestId('booking-sheet')).toBeVisible()
    await expect(page.getByTestId('check-in-button')).toHaveCount(0)
    await expect(page.getByTestId('booking-note')).toContainText('เช็กอินได้ในคืนวันที่')
    const r = await dbAs('bar').rpc('check_in_booking', { p_branch: branchA, p_ref: b.code })
    expect(r.error?.message).toBe('WRONG_NIGHT')
    const { data } = await admin().from('bookings').select('status').eq('id', b.id).single()
    expect(data?.status).toBe('confirmed')
  })

  test('P2-B2-06 from the plan: tapping a booked cell opens the same sheet (dialog)', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: NIGHT, slotTime: '19:30', status: 'confirmed', tableId: zt.tableA1, zoneId: zt.zoneStage })
    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await page.getByTestId('table-cell').first().click()
    const sheet = page.getByTestId('booking-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(b.code)
    await expect(page.getByRole('dialog')).toBeVisible()
    // bar can change the table from the sheet too
    await page.getByTestId('change-table-trigger').click()
    await page.getByTestId('change-table-select').selectOption(zt.tableA2)
    await expect(page.getByText('จัดโต๊ะแล้ว')).toBeVisible()
    const { data } = await admin().from('bookings').select('table_id').eq('id', b.id).single()
    expect(data?.table_id).toBe(zt.tableA2)
  })

  test('P2-B2-07 bar cancels a confirmed booking from the sheet: cancelled, table freed, the customer told on LINE', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: NIGHT, slotTime: '20:00', status: 'confirmed', tableId: zt.tableA1, zoneId: zt.zoneStage })
    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await page.getByTestId('table-cell').first().click()
    const sheet = page.getByTestId('booking-sheet')
    await expect(sheet).toContainText(b.code)
    await sheet.getByTestId('cancel-booking-button').click()
    await page.getByLabel('เหตุผลที่ยกเลิก').fill('ลูกค้าโทรมายกเลิก')
    await page.getByTestId('cancel-booking-submit').click()
    await expect(page.getByText('ยกเลิกการจองแล้ว')).toBeVisible()
    await expect(sheet.getByTestId('cancel-booking-button')).toHaveCount(0)
    await expect(sheet.getByTestId('check-in-button')).toHaveCount(0) // a cancelled booking has nothing to check in (R-053)

    const { data } = await admin().from('bookings').select('status, table_id, cancel_reason, cancelled_by_customer').eq('id', b.id).single()
    expect(data).toEqual({ status: 'cancelled', table_id: null, cancel_reason: 'ลูกค้าโทรมายกเลิก', cancelled_by_customer: false })
    const { count } = await admin().from('line_outbox').select('id', { count: 'exact', head: true }).eq('dedupe_key', `booking_cancelled:${b.id}`)
    expect(count).toBe(1)
  })

  test('P2-B2-09 a waiting booking: bar confirms and seats it, or rejects it, from the sheet; another night offers no check-in', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const tonight = businessNight()
    const open = async (code: string) => {
      await page.goto('/scan')
      await page.getByTestId('scan-input').fill(code)
      await page.getByRole('button', { name: 'ค้นหา' }).click()
      await expect(page.getByTestId('booking-sheet')).toBeVisible()
    }

    const a = await insertBooking({ night: tonight, slotTime: '21:00', status: 'pending', name: 'P2B2 รอยืนยัน 1' })
    await open(a.code)
    const sheet = page.getByTestId('booking-sheet')
    await expect(sheet.getByTestId('booking-note')).toHaveAttribute('data-note', 'pending')
    await expect(sheet.getByTestId('check-in-button')).toHaveText('ลูกค้ามาแล้ว')
    await sheet.getByTestId('confirm-booking-button').click()
    await page.getByTestId('assign-table-select').selectOption(zt.tableA1)
    await page.getByTestId('assign-confirm-submit').click()
    await expect(sheet.getByTestId('booking-decide')).toHaveCount(0)
    await expect(sheet).toContainText('PA1')
    expect((await admin().from('bookings').select('status, table_id').eq('id', a.id).single()).data).toEqual({ status: 'confirmed', table_id: zt.tableA1 })

    const r = await insertBooking({ night: tonight, slotTime: '21:30', status: 'pending', name: 'P2B2 รอยืนยัน 2' })
    await open(r.code)
    await page.getByTestId('reject-booking-button').click()
    await page.locator('#rej-reason').fill('โต๊ะเต็ม')
    await page.getByTestId('reject-submit').click()
    await expect(page.getByTestId('booking-decide')).toHaveCount(0)
    await expect(page.getByTestId('check-in-button')).toHaveCount(0)
    expect((await admin().from('bookings').select('status').eq('id', r.id).single()).data?.status).toBe('rejected')

    const later = await insertBooking({ night: NIGHT, slotTime: '20:00', status: 'pending', name: 'P2B2 รอยืนยัน 3' })
    await open(later.code)
    await expect(page.getByTestId('confirm-booking-button')).toBeVisible()
    await expect(page.getByTestId('check-in-button')).toHaveCount(0)
    await expect(page.getByTestId('booking-note')).toContainText('รอร้านยืนยัน')
  })

  test('P2-B2-10 ไม่มา · ปล่อยโต๊ะ: a late confirmed guest is a no-show now, the table free; checked in late after all; never before the time, never by staff', async ({ page }) => {
    const bkk = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const [h, m] = bkk.format(new Date()).split(':').map(Number)
    test.skip(h === 6 && m < 12, 'straddles the 06:00 night rollover')
    await clearBookings(admin(), [branchA])
    // the slots start at midnight for this test, so "10 minutes ago" is past the booking at any hour
    await resetSettings(admin(), branchA, { slot_start: '00:00' })
    try {
      const b = await insertBooking({ night: businessNight(), slotTime: bkk.format(new Date(Date.now() - 10 * 60_000)), status: 'confirmed', tableId: zt.tableA1, zoneId: zt.zoneStage })
      await page.goto('/scan')
      await page.getByTestId('scan-input').fill(b.code)
      await page.getByRole('button', { name: 'ค้นหา' }).click()
      const sheet = page.getByTestId('booking-sheet')
      await sheet.getByTestId('no-show-button').click()
      await page.getByTestId('no-show-submit').click()
      await expect(sheet.getByTestId('check-in-button')).toHaveText('ลูกค้ามาแล้ว (มาสาย)')
      await expect(sheet.getByTestId('no-show-button')).toHaveCount(0)
      expect((await admin().from('bookings').select('status, table_id').eq('id', b.id).single()).data).toEqual({ status: 'no_show', table_id: null })
      const { data: log } = await admin().from('audit_log').select('actor_id').eq('target_id', b.id).eq('action', 'booking.no_show')
      expect(log?.map((l) => l.actor_id)).toEqual([fixtureIds().users.bar])

      await sheet.getByTestId('check-in-button').click()
      await expect(sheet.getByTestId('check-in-button')).toHaveText('เช็กอินแล้ว')
      expect((await admin().from('bookings').select('status').eq('id', b.id).single()).data?.status).toBe('arrived')

      const ahead = await insertBooking({ night: NIGHT, slotTime: '20:00', status: 'confirmed' })
      expect((await dbAs('bar').rpc('mark_booking_no_show', { p_booking: ahead.id })).error?.message).toBe('NOT_LATE')
      expect((await dbAs('staff').rpc('mark_booking_no_show', { p_booking: ahead.id })).error?.message).toBe('BAR_ONLY')
    } finally {
      await resetSettings(admin(), branchA)
    }
  })

  test('P2-B2-12 a waiting booking holding the table its customer picked: the note names it, ยืนยัน keeps it, the sheet still shows it', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: businessNight(), slotTime: '23:30', status: 'pending', tableId: zt.tableA2, zoneId: zt.zoneStage, name: 'P2B2 เลือกโต๊ะเอง' })
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(b.code)
    await page.getByRole('button', { name: 'ค้นหา' }).click()
    const sheet = page.getByTestId('booking-sheet')
    await expect(sheet.getByTestId('booking-note')).toContainText('ที่โต๊ะ PA2')
    await sheet.getByTestId('confirm-booking-button').click()
    await expect(page.getByTestId('assign-table-select')).toHaveValue(zt.tableA2)
    await page.getByTestId('assign-confirm-submit').click()
    await expect(sheet.getByTestId('booking-decide')).toHaveCount(0)
    await expect(sheet).toContainText('PA2')
    await expect(sheet).not.toContainText('ยังไม่จัดโต๊ะ')
    expect((await admin().from('bookings').select('status, table_id').eq('id', b.id).single()).data).toEqual({ status: 'confirmed', table_id: zt.tableA2 })
  })

  test('P2-B2-13 ไม่มา · ปล่อยโต๊ะ on a waiting booking past its time: a no-show, the table it held free', async ({ page }) => {
    const bkk = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const [h, m] = bkk.format(new Date()).split(':').map(Number)
    test.skip(h === 6 && m < 12, 'straddles the 06:00 night rollover')
    await clearBookings(admin(), [branchA])
    await resetSettings(admin(), branchA, { slot_start: '00:00' })
    try {
      const b = await insertBooking({ night: businessNight(), slotTime: bkk.format(new Date(Date.now() - 10 * 60_000)), status: 'pending', tableId: zt.tableA1, zoneId: zt.zoneStage })
      await page.goto('/scan')
      await page.getByTestId('scan-input').fill(b.code)
      await page.getByRole('button', { name: 'ค้นหา' }).click()
      const sheet = page.getByTestId('booking-sheet')
      await expect(sheet.getByTestId('booking-decide')).toBeVisible()
      await sheet.getByTestId('no-show-button').click()
      await page.getByTestId('no-show-submit').click()
      await expect(sheet.getByTestId('check-in-button')).toHaveText('ลูกค้ามาแล้ว (มาสาย)')
      await expect(sheet.getByTestId('booking-decide')).toHaveCount(0)
      expect((await admin().from('bookings').select('status, table_id').eq('id', b.id).single()).data).toEqual({ status: 'no_show', table_id: null })
    } finally {
      await resetSettings(admin(), branchA)
    }
  })
})

test.describe('staff cannot change table', () => {
  test.use({ storageState: as('staff') })

  test('P2-B2-staff no เปลี่ยนโต๊ะ control in the sheet', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: NIGHT, slotTime: '22:00', status: 'confirmed', tableId: zt.tableV1, zoneId: zt.zoneVip })
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(b.code)
    await page.getByRole('button', { name: 'ค้นหา' }).click()
    await expect(page.getByTestId('booking-sheet')).toBeVisible()
    await expect(page.getByTestId('change-table-trigger')).toHaveCount(0)
  })

  test('P2-B2-08 staff: no ยกเลิกการจอง in the sheet, and cancel_booking answers BAR_ONLY', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: NIGHT, slotTime: '21:30', status: 'confirmed', tableId: zt.tableV1, zoneId: zt.zoneVip })
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(b.code)
    await page.getByRole('button', { name: 'ค้นหา' }).click()
    await expect(page.getByTestId('booking-sheet')).toBeVisible()
    await expect(page.getByTestId('cancel-booking-button')).toHaveCount(0)
    const r = await dbAs('staff').rpc('cancel_booking', { p_booking: b.id } as never)
    expect(r.error?.message).toContain('BAR_ONLY')
    expect((await admin().from('bookings').select('status').eq('id', b.id).single()).data?.status).toBe('confirmed')
  })

  test('P2-B2-11 staff: a waiting booking tonight has no ยืนยัน / ปฏิเสธ, and ลูกค้ามาแล้ว checks it in at once', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: businessNight(), slotTime: '22:30', status: 'pending' })
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(b.code)
    await page.getByRole('button', { name: 'ค้นหา' }).click()
    await expect(page.getByTestId('booking-sheet')).toBeVisible()
    await expect(page.getByTestId('confirm-booking-button')).toHaveCount(0)
    await expect(page.getByTestId('reject-booking-button')).toHaveCount(0)
    await expect(page.getByTestId('no-show-button')).toHaveCount(0)
    await page.getByTestId('check-in-button').click()
    await expect(page.getByTestId('check-in-button')).toHaveText('เช็กอินแล้ว')
    const { data } = await admin().from('bookings').select('status, confirmed_at').eq('id', b.id).single()
    expect(data?.status).toBe('arrived')
    expect(data?.confirmed_at).not.toBeNull()
  })
})
