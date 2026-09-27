import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addDays, bangkokParts, businessNight } from '../../src/lib/date'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
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
    const rows = page.getByTestId('booking-list').locator(':scope > div')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('19:00')
    await expect(rows.nth(1)).toContainText('22:00')
    await expect(rows.nth(0).getByRole('button', { name: 'ยืนยัน + จัดโต๊ะ' })).toBeVisible()
    await expect(rows.nth(0).getByRole('button', { name: 'ปฏิเสธ', exact: true })).toBeVisible()

    const staffCtx = await browser.newContext({ storageState: as('staff') })
    const staffPage = await staffCtx.newPage()
    await staffPage.goto(`/bookings?night=${NIGHT}&view=list`)
    const staffRows = staffPage.getByTestId('booking-list').locator(':scope > div')
    await expect(staffRows.nth(0).getByRole('button', { name: 'ยืนยัน + จัดโต๊ะ' })).toHaveCount(0)
    await expect(staffRows.nth(0).getByText('รอร้านยืนยัน')).toBeVisible()
    await staffCtx.close()
  })

  test('P2-B1-12 /bookings opens on the list, its tab first; ดูผังโต๊ะ on tonight still opens the plan', async ({ page }) => {
    await page.goto('/bookings')
    const tabs = page.getByRole('tablist').first().getByRole('tab')
    await expect(tabs.first()).toHaveText('รายการ')
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false')
    await page.goto('/tonight')
    await page.locator('a[href="/bookings?view=plan"]').first().click()
    await expect(page).toHaveURL(/view=plan/)
    await expect(page.getByRole('tablist').first().getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true')
  })

  test('P2-B1-03 night picker changes the data and the subtitle counts', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    await insertBooking({ night: NIGHT, slotTime: '19:00', status: 'confirmed', tableId: zt.tableA1, party: 5 })
    const other = addDays(NIGHT, 1)
    await insertBooking({ night: other, slotTime: '19:00', status: 'confirmed', tableId: zt.tableA2, party: 2 })

    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await expect(page.getByTestId('bookings-subtitle')).toContainText('5')
    // (owner, 2026-09-27) the night in four figures, and each zone's booked | free
    const stat = (k: string) => page.locator(`[data-testid="bookings-stat"][data-key="${k}"]`)
    await expect(stat('booked')).toHaveAttribute('data-value', '1')
    await expect(stat('people')).toHaveAttribute('data-value', '5')
    await expect(stat('arrived')).toHaveAttribute('data-value', '0')
    const zones = page.getByTestId('zone-summary')
    const booked = await zones.evaluateAll((els) => els.reduce((n, e) => n + Number(e.getAttribute('data-booked')), 0))
    const free = await zones.evaluateAll((els) => els.reduce((n, e) => n + Number(e.getAttribute('data-free')), 0))
    const cells = await page.getByTestId('table-cell').count()
    expect(booked).toBe(1)
    await expect(stat('free')).toHaveAttribute('data-value', String(cells - 1))
    expect(free).toBeLessThanOrEqual(cells - 1)
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
    const row = page.getByTestId('booking-list').locator(':scope > div', { hasText: '21:00' })
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
    const row = page.getByTestId('booking-list').locator(':scope > div', { hasText: '22:30' })
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

  test('P2-B1-09 no zones → empty state with a link to ตั้งค่า → ผังโต๊ะ', async ({ page, context }) => {
    const { branchB: ownerBranchB } = fixtureIds()
    await teardownZonesAndTables(admin(), ownerBranchB)
    // owner sees every branch; pin sis_branch directly (no cookie in storageState → the app
    // would otherwise default to the alphabetically-first branch, which is another fixture's)
    await context.addCookies([{ name: 'sis_branch', value: ownerBranchB, url: BASE_URL }])
    await page.goto('/tonight')
    await expect(page.locator('[data-testid="branch-switcher-current"]:visible').first()).toContainText(BRANCH_B_NAME)
    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    await expect(page.getByText('ยังไม่มีผังโต๊ะ')).toBeVisible()
    await expect(page.getByRole('link', { name: 'ยังไม่มีผังโต๊ะ' })).toBeVisible()
  })
})

test.describe('pending panel', () => {
  test.use({ storageState: as('bar') })

  test('P2-B1-10 รอยืนยัน lists pending bookings from tonight on by night, whatever night is picked; a row opens its sheet', async ({ page }) => {
    const tonight = businessNight()
    const later = addDays(tonight, 3)
    const a = await insertBooking({ night: tonight, slotTime: '21:00', status: 'pending', name: 'P2B pending tonight' })
    const b = await insertBooking({ night: later, slotTime: '20:30', status: 'pending', name: 'P2B pending later' })
    const past = await insertBooking({ night: addDays(tonight, -1), slotTime: '20:00', status: 'pending', name: 'P2B pending past' })
    const done = await insertBooking({ night: later, slotTime: '22:00', status: 'confirmed', name: 'P2B confirmed later' })

    // a picked night that shows none of them
    await page.goto(`/bookings?night=${addDays(tonight, 9)}&view=list`)
    const panel = page.getByTestId('pending-bookings')
    const group = (night: string) => panel.locator(`[data-testid="pending-night"][data-night="${night}"]`)
    await expect(group(tonight)).toContainText(a.code)
    await expect(group(tonight)).toContainText('คืนนี้')
    await expect(group(later)).toContainText(b.code)
    await expect(panel).not.toContainText(past.code)
    await expect(panel).not.toContainText(done.code)
    const nights = await panel.getByTestId('pending-night').evaluateAll((els) => els.map((e) => e.getAttribute('data-night')!))
    expect(nights).toEqual([...nights].sort())

    // bar gets the row actions; tapping the row opens the booking sheet at once
    const row = panel.locator(`[data-testid="pending-row"][data-code="${b.code}"]`)
    await expect(row.getByRole('button', { name: 'ยืนยัน + จัดโต๊ะ' })).toBeVisible()
    await row.click()
    await expect(page.getByRole('dialog')).toContainText(b.code)
  })
})

const cell = (page: Page, label: string) => page.locator(`[data-testid="table-cell"][data-label="${label}"]`)

test.describe('plan: tap a table', () => {
  test.use({ storageState: as('bar') })

  test('P2-B1-11 a waiting booking that holds a table reads รอยืนยัน on the plan; tapping it confirms it on that table', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    const b = await insertBooking({ night: NIGHT, slotTime: '21:00', status: 'pending', tableId: zt.tableA1, zoneId: zt.zoneStage, name: 'P2B เลือกโต๊ะเอง' })
    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    for (const word of ['รอยืนยัน', 'ปิดจอง']) await expect(page.locator('.legend')).toContainText(word)
    const a1 = cell(page, 'PA1')
    await expect(a1).toHaveAttribute('data-state', 'pending')
    await expect(a1).toContainText('รอยืนยัน')
    await a1.click()
    const sheet = page.getByTestId('booking-sheet')
    await expect(sheet).toContainText(b.code)
    await expect(sheet.getByTestId('reject-booking-button')).toBeVisible()
    await sheet.getByTestId('confirm-booking-button').click()
    // starts on the table the booking holds, and offers no "none" (confirm_booking would keep it anyway)
    await expect(page.getByTestId('assign-table-select')).toHaveValue(zt.tableA1)
    await expect(page.getByTestId('assign-table-select').locator('option[value=""]')).toHaveCount(0)
    await page.getByTestId('assign-confirm-submit').click()
    await expect(sheet.getByTestId('booking-decide')).toHaveCount(0)
    await expect(sheet).toContainText('PA1')
    expect((await admin().from('bookings').select('status, table_id').eq('id', b.id).single()).data).toEqual({ status: 'confirmed', table_id: zt.tableA1 })
    await page.keyboard.press('Escape')
    await expect(a1).toHaveAttribute('data-state', 'booked')
  })

  test('P2-B1-12 tapping a free table opens รับจอง on that night and table; on a past night a free table does nothing', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    const a2 = cell(page, 'PA2')
    await expect(a2).toHaveAttribute('data-action', 'book')
    await a2.click()
    await expect(page.getByRole('dialog')).toContainText('รับจองโต๊ะ PA2')
    await expect(page.locator('#bf-night')).toHaveValue(NIGHT)
    await expect(page.locator('#bf-zone')).toHaveValue(zt.zoneStage)
    await expect(page.locator('#bf-table')).toHaveValue(zt.tableA2)
    await page.getByLabel('ชื่อลูกค้า').fill('P2B จากผังโต๊ะ')
    await page.getByLabel('จำนวนคน').fill('2')
    await page.getByTestId('booking-form-submit').click()
    await expect(page.getByText(/บันทึกการจองแล้ว/)).toBeVisible()
    await expect(a2).toHaveAttribute('data-state', 'booked')
    await expect(a2).toContainText('P2B จากผังโต๊ะ')
    const { data } = await admin().from('bookings').select('table_id, status, night').eq('branch_id', branchA).eq('name', 'P2B จากผังโต๊ะ').single()
    expect(data).toEqual({ table_id: zt.tableA2, status: 'confirmed', night: NIGHT })

    await page.goto(`/bookings?night=${addDays(businessNight(), -1)}&view=plan`)
    const past = cell(page, 'PA1')
    await expect(past).toHaveAttribute('data-state', 'free')
    expect(await past.getAttribute('data-action')).toBeNull()
    await past.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('P2-B1-13 bar closes a free table for the night with no customer details — ปิดจอง here, booked to customers — and opens it again', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    await admin().from('table_blocks').delete().eq('branch_id', branchA)
    await page.goto(`/bookings?night=${NIGHT}&view=plan`)
    const a1 = cell(page, 'PA1')
    await a1.click()
    await expect(page.getByTestId('close-table-box')).toBeVisible()
    await page.getByTestId('close-table-button').click()
    await expect(page.getByText(/ปิดการจองโต๊ะ PA1/)).toBeVisible()
    await expect(a1).toHaveAttribute('data-state', 'closed')
    await expect(a1).toContainText('ปิดจอง')
    // red at a glance — the border and the table's name (R-057), not only the word
    const red = await a1.evaluate((el) => {
      const probe = document.createElement('i')
      probe.style.color = 'var(--urgent)'
      document.body.append(probe)
      const want = getComputedStyle(probe).color
      probe.remove()
      return getComputedStyle(el).borderTopColor === want && getComputedStyle(el.querySelector('b')!).color === want
    })
    expect(red).toBe(true)
    const blocks = async () => (await admin().from('table_blocks').select('night, created_by').eq('table_id', zt.tableA1)).data
    expect(await blocks()).toEqual([{ night: NIGHT, created_by: fixtureIds().users.bar }])
    type Plan = { zones: { tables: { id: string; state: string }[] }[] }
    const plan = (await admin().rpc('table_availability', { p_branch: branchA, p_night: NIGHT })).data as unknown as Plan
    expect(plan.zones.flatMap((z) => z.tables).find((x) => x.id === zt.tableA1)?.state).toBe('taken')

    await a1.click()
    await expect(page.getByRole('dialog')).toContainText('โต๊ะ PA1 · ปิดจอง')
    await page.getByTestId('reopen-table-button').click()
    await expect(page.getByText('เปิดให้จองโต๊ะ PA1 แล้ว')).toBeVisible()
    await expect(a1).toHaveAttribute('data-state', 'free')
    expect(await blocks()).toEqual([])

    // set_table_closed's own lines: not a booked table, not a past night, not staff
    await insertBooking({ night: NIGHT, slotTime: '22:00', status: 'confirmed', tableId: zt.tableA2, zoneId: zt.zoneStage })
    expect((await dbAs('bar').rpc('set_table_closed', { p_table: zt.tableA2, p_night: NIGHT, p_closed: true })).error?.message).toBe('table_taken')
    expect((await dbAs('bar').rpc('set_table_closed', { p_table: zt.tableA1, p_night: addDays(businessNight(), -1), p_closed: true })).error?.message).toBe('past')
    expect((await dbAs('staff').rpc('set_table_closed', { p_table: zt.tableA1, p_night: NIGHT, p_closed: true })).error?.message).toBe('BAR_ONLY')
    expect(await blocks()).toEqual([])
  })
})

test.describe('plan as staff', () => {
  test.use({ storageState: as('staff') })

  test('P2-B1-14 staff: a free table opens รับจอง without ปิดการจองโต๊ะนี้; a closed table offers nothing', async ({ page }) => {
    await clearBookings(admin(), [branchA])
    await admin().from('table_blocks').delete().eq('branch_id', branchA)
    const block = await admin().from('table_blocks').insert({ branch_id: branchA, table_id: zt.tableA2, night: NIGHT })
    expect(block.error, block.error?.message).toBeNull()
    try {
      await page.goto(`/bookings?night=${NIGHT}&view=plan`)
      await cell(page, 'PA1').click()
      await expect(page.getByRole('dialog')).toContainText('รับจองโต๊ะ PA1')
      await expect(page.getByTestId('close-table-box')).toHaveCount(0)
      await page.keyboard.press('Escape')
      const a2 = cell(page, 'PA2')
      await expect(a2).toHaveAttribute('data-state', 'closed')
      expect(await a2.getAttribute('data-action')).toBeNull()
    } finally {
      await admin().from('table_blocks').delete().eq('branch_id', branchA)
    }
  })
})
