import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { addDays, bangkokParts, businessNight } from '../../src/lib/date'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { BRANCH_B_NAME } from './fixtures/users'
import { clearBookings, resetSettings, setupZonesAndTables, teardownZonesAndTables, type ZoneTableSet } from './fixtures/p2b-bookings'

test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const admin = () => adminDb()
const NIGHT = addDays(businessNight(), 5)
const LINE_USER = `U${'2b1'.repeat(10)}2b`
let branchA = ''
let branchB = ''
let zt: ZoneTableSet
let customerId = ''
let seq = 0

/** Fixture rows built directly — the RPC's own business rules are P1's job, not this UI spec's. */
async function insertBooking(over: {
  night: string
  slotTime: string
  status?: 'pending' | 'confirmed' | 'arrived' | 'rejected'
  tableId?: string | null
  zoneId?: string | null
  name?: string
  party?: number
  source?: 'line' | 'staff'
}) {
  seq += 1
  const mmdd = over.night.slice(5, 7) + over.night.slice(8, 10)
  const { data, error } = await admin()
    .from('bookings')
    .insert({
      branch_id: branchA,
      code: `BK-${mmdd}-${String(900 + seq).slice(0, 3)}`,
      night: over.night,
      slot_time: over.slotTime,
      party_size: over.party ?? 4,
      zone_id: over.zoneId ?? null,
      table_id: over.tableId ?? null,
      customer_id: customerId,
      name: over.name ?? 'P2B ลูกค้า',
      source: over.source ?? 'line',
      status: over.status ?? 'confirmed',
    })
    .select('id, code, qr_token')
    .single()
  if (error) throw new Error(`insertBooking: ${error.message}`)
  return data
}

async function lineBook(patch: Record<string, unknown> = {}) {
  return admin().rpc('create_booking', {
    p_branch: branchA, p_night: NIGHT, p_slot: '20:00', p_party: 4, p_name: 'P2B ลูกค้า',
    p_phone: '080-000-1111', p_zone: zt.zoneStage, p_customer_id: customerId, ...patch,
  } as never)
}

const ok = <T,>(r: { data: T; error: { message: string } | null }) => {
  expect(r.error, r.error?.message).toBeNull()
  return r.data as unknown as { id: string; code: string; status: string; qr_token: string }
}

test.beforeAll(async () => {
  const ids = fixtureIds()
  branchA = ids.branchA
  branchB = ids.branchB
  await clearBookings(admin(), [branchA, branchB])
  await resetSettings(admin(), branchA)
  zt = await setupZonesAndTables(admin(), branchA)
  const c = await admin().from('customers').upsert({ line_user_id: LINE_USER, display_name: 'P2B LINE', locale: 'th' }, { onConflict: 'line_user_id' }).select('id').single()
  if (c.error || !c.data) throw new Error(`customer fixture: ${c.error?.message}`)
  customerId = c.data.id
})

test.afterAll(async () => {
  await clearBookings(admin(), [branchA, branchB])
  await resetSettings(admin(), branchA)
  await teardownZonesAndTables(admin(), branchA)
  await admin().from('customers').delete().eq('line_user_id', LINE_USER)
})

test.describe('plan + list', () => {
  test.use({ storageState: as('bar') })

  test('P2-B1-01 plan view shows free / booked / arrived / late cells with a legend', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    await insertBooking({ night: NIGHT, slotTime: '23:00', status: 'confirmed', tableId: zt.tableA1, zoneId: zt.zoneStage })
    await insertBooking({ night: NIGHT, slotTime: '19:30', status: 'arrived', tableId: zt.tableA2, zoneId: zt.zoneStage })

    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await expect(page.getByTestId('table-cell')).toHaveCount(3)
    await expect(page.locator('.t-cell[data-state="booked"]')).toHaveCount(1)
    await expect(page.locator('.t-cell[data-state="arrived"]')).toHaveCount(1)
    await expect(page.locator('.t-cell[data-state="free"]')).toHaveCount(1)
    await expect(page.locator('.legend')).toBeVisible()
    for (const word of ['ว่าง', 'จองแล้ว', 'มาแล้ว', 'เลยเวลา']) {
      await expect(page.locator('.legend')).toContainText(word)
    }
    await clearBookings(admin(), [branchA])

    // "late": a slot a few minutes before real now, on tonight's business night — the
    // business-night rule for the fixture booking and for cellState() are the same
    // function family (lib/date.businessNight / lib/booking/format.slotInstant), so
    // this stays correct at any time of day except the ~5-minute window around 06:00.
    const todayNight = businessNight()
    const past = bangkokParts(Date.now() - 5 * 60_000)
    const pastSlot = `${String(past.hour).padStart(2, '0')}:${String(past.minute).padStart(2, '0')}`
    await insertBooking({ night: todayNight, slotTime: pastSlot, status: 'confirmed', tableId: zt.tableV1, zoneId: zt.zoneVip })
    await page.goto(`/bookings?night=${todayNight}&view=plan`)
    await expect(page.locator('.t-cell[data-state="late"]')).toHaveCount(1)
    await clearBookings(admin(), [branchA])
  })

  test('P2-B1-02 list view: sorted by slot, pending row shows ยืนยัน+จัดโต๊ะ/ปฏิเสธ for bar only', async ({ page, browser }) => {
    await clearBookings(admin(), [branchA])
    ok(await lineBook({ p_slot: '22:00' }))
    ok(await lineBook({ p_slot: '19:00' }))

    await page.goto(`/bookings?night=${NIGHT}&view=list`)
    const rows = page.locator('.panel > div')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('19:00')
    await expect(rows.nth(1)).toContainText('22:00')
    await expect(rows.nth(0).getByRole('button', { name: 'ยืนยัน + จัดโต๊ะ' })).toBeVisible()
    await expect(rows.nth(0).getByRole('button', { name: 'ปฏิเสธ', exact: true })).toBeVisible()

    const staffCtx = await browser.newContext({ storageState: as('staff') })
    const staffPage = await staffCtx.newPage()
    await staffPage.goto(`/bookings?night=${NIGHT}&view=list`)
    const staffRows = staffPage.locator('.panel > div')
    await expect(staffRows.nth(0).getByRole('button', { name: 'ยืนยัน + จัดโต๊ะ' })).toHaveCount(0)
    await expect(staffRows.nth(0).getByText('รอร้านยืนยัน')).toBeVisible()
    await staffCtx.close()
  })

  test('P2-B1-03 night picker changes the data and the subtitle counts', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    await insertBooking({ night: NIGHT, slotTime: '19:00', status: 'confirmed', tableId: zt.tableA1, party: 5 })
    const other = addDays(NIGHT, 1)
    await insertBooking({ night: other, slotTime: '19:00', status: 'confirmed', tableId: zt.tableA2, party: 2 })

    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await expect(page.getByTestId('bookings-subtitle')).toContainText('5')
    // the prev/next buttons are plain <button>s — more reliable in CI than fill()
    // on a native <input type="date"> (OS-locale-dependent under Chromium/Windows)
    await page.getByRole('button', { name: 'ถัดไป' }).click()
    await expect(page).toHaveURL(new RegExp(`night=${other}`))
    await expect(page.getByTestId('bookings-subtitle')).toContainText('2')
  })

  test('P2-B1-04 รับจอง form creates a confirmed staff booking', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    await page.goto(`/bookings?night=${NIGHT}&view=list`)
    await page.getByTestId('new-booking-button').click()
    await page.getByLabel('ชื่อลูกค้า').fill('P2B แบบฟอร์ม')
    await page.getByLabel('จำนวนคน').fill('3')
    await page.getByLabel('โซน').selectOption(zt.zoneStage)
    await page.getByTestId('booking-form-submit').click()
    await expect(page.getByText(/บันทึกการจองแล้ว/)).toBeVisible()
    await expect(page.getByText('P2B แบบฟอร์ม')).toBeVisible()
    const { data } = await admin().from('bookings').select('status, source, name').eq('branch_id', branchA).eq('name', 'P2B แบบฟอร์ม').single()
    expect(data?.status).toBe('confirmed')
    expect(data?.source).toBe('staff')
  })

  test('P2-B1-05 P2-B1-06 confirm + assign table; a taken table is refused', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const a = ok(await lineBook({ p_slot: '21:00' }))
    await admin().from('bookings').update({ status: 'confirmed', table_id: zt.tableA1 }).eq('id', (ok(await lineBook({ p_slot: '21:30' }))).id)

    await page.goto(`/bookings?night=${NIGHT}&view=list`)
    const row = page.locator('.panel > div', { hasText: '21:00' })
    await row.getByRole('button', { name: 'ยืนยัน + จัดโต๊ะ' }).click()
    await page.getByTestId('assign-table-select').selectOption(zt.tableA1)
    await page.getByTestId('assign-confirm-submit').click()
    await expect(page.getByText('โต๊ะนี้ถูกจองในคืนนี้แล้ว')).toBeVisible()
    await page.getByTestId('assign-table-select').selectOption(zt.tableA2)
    await page.getByTestId('assign-confirm-submit').click()
    await expect(page.getByText('บันทึกแล้ว')).toBeVisible()
    const { data } = await admin().from('bookings').select('status, table_id').eq('id', a.id).single()
    expect(data?.status).toBe('confirmed')
    expect(data?.table_id).toBe(zt.tableA2)

    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await expect(page.locator('.t-cell').filter({ hasText: 'PA2' })).toContainText('P2B ลูกค้า')
  })

  test('P2-B1-07 reject with a reason leaves the plan', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const p = ok(await lineBook({ p_slot: '22:30' }))
    await page.goto(`/bookings?night=${NIGHT}&view=list`)
    const row = page.locator('.panel > div', { hasText: '22:30' })
    await row.getByRole('button', { name: 'ปฏิเสธ', exact: true }).click()
    await page.getByLabel('เหตุผลที่ปฏิเสธ').fill('ลูกค้ายกเลิกทางโทรศัพท์')
    await page.getByTestId('reject-submit').click()
    await expect(page.getByText('บันทึกแล้ว')).toBeVisible()
    const { data } = await admin().from('bookings').select('status').eq('id', p.id).single()
    expect(data?.status).toBe('rejected')
    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await expect(page.locator('.t-cell:not([data-state="free"])')).toHaveCount(0)
  })

  test('P2-B1-08 a closed night shows the banner', async ({ page }) => {
    const blackNight = addDays(NIGHT, 10)
    await admin().from('booking_blackouts').insert({ branch_id: branchA, night: blackNight, reason: 'P2B ปิดร้าน' })
    await page.goto(`/bookings?night=${blackNight}&view=plan`)
    await expect(page.getByTestId('closed-night-banner')).toBeVisible()
    await expect(page.getByTestId('closed-night-banner')).toContainText('P2B ปิดร้าน')
    await admin().from('booking_blackouts').delete().eq('branch_id', branchA).eq('night', blackNight)
  })
})

test.describe('empty zones (owner)', () => {
  test.use({ storageState: as('owner') })

  test('P2-B1-09 no zones → empty state with a link to ตั้งค่า → ผังโต๊ะ', async ({ page }) => {
    const { branchB: ownerBranchB } = fixtureIds()
    await teardownZonesAndTables(admin(), ownerBranchB)
    await page.goto('/tonight')
    const switcher = page.getByTestId('branch-switcher').first()
    await switcher.selectOption(ownerBranchB)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(BRANCH_B_NAME)
    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await expect(page.getByText('ยังไม่มีผังโต๊ะ')).toBeVisible()
    await expect(page.getByRole('link', { name: 'ยังไม่มีผังโต๊ะ' })).toBeVisible()
  })
})
