import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { RUN, cleanupRun, confirmAll, createDeposit, mustCreate } from './fixtures/deposits'
import { bottleIds, createLineRequest, requestWithdrawal } from './fixtures/p2a-flows'
import { addDays, bangkokDate, businessNight } from '../../src/lib/date'

const as = (role: string) => join(AUTH_DIR, `${role}.json`)

test.describe.configure({ mode: 'serial' })

let confirmedBookingId = ''
let confirmedBookingCode = ''
let tomorrowBookingCode = ''
let toConfirmDep: { id: string; code: string }
let withdrawDep: { id: string; code: string }
let lineRequestDep: { id: string; code: string }
let expiringDep: { id: string; code: string }
let scanDep: { id: string; code: string }
let branchBDep: { id: string; code: string }

test.beforeAll(async () => {
  const { branchA } = fixtureIds()
  const night = businessNight()

  const { data: booking, error: bookingError } = await dbAs('staff').rpc('create_booking', {
    p_branch: branchA,
    p_night: night,
    p_slot: '20:00:00',
    p_party: 4,
    p_name: `${RUN} คุณจอง`,
  })
  expect(bookingError, bookingError?.message).toBeNull()
  const b = booking as { id: string; code: string }
  confirmedBookingId = b.id
  confirmedBookingCode = b.code

  // R-052: a booking tomorrow for the จองพรุ่งนี้ shortcut on the scan page
  const { data: later, error: laterError } = await dbAs('staff').rpc('create_booking', {
    p_branch: branchA,
    p_night: addDays(night, 1),
    p_slot: '20:30:00',
    p_party: 2,
    p_name: `${RUN} คุณพรุ่งนี้`,
  })
  expect(laterError, laterError?.message).toBeNull()
  tomorrowBookingCode = (later as { code: string }).code

  toConfirmDep = await mustCreate('staff', { qty: 1 })

  withdrawDep = await mustCreate('staff', { qty: 1 })
  await confirmAll(withdrawDep.id, [100])
  const ids = await bottleIds(withdrawDep.id)
  await requestWithdrawal(withdrawDep.id, ids, 'take_home', 'staff')

  lineRequestDep = await createLineRequest(branchA, { qty: 1 })

  const { data: expiringData, error: expiringError } = await createDeposit('bar', { qty: 1, expiresAt: `${addDays(bangkokDate(), 4)}T12:00:00+07:00` })
  expect(expiringError, expiringError?.message).toBeNull()
  expiringDep = expiringData!
  await confirmAll(expiringDep.id, [100])

  scanDep = await mustCreate('staff', { qty: 2 })
  await confirmAll(scanDep.id, [100, 50])

  branchBDep = await mustCreate('staffB', { qty: 1, branch: 'B' })
})

test.afterAll(async () => {
  await cleanupRun()
  const { branchA } = fixtureIds()
  await adminDb().from('bookings').delete().eq('branch_id', branchA).like('name', `${RUN}%`)
})

test.describe('bar', () => {
  test.use({ storageState: as('bar') })

  test('P2-A3-01 KPIs: bookings, รอ bar ยืนยันเหล้า, คำขอเบิก, ใกล้หมดอายุ', async ({ page }) => {
    const { branchA } = fixtureIds()
    const admin = adminDb()
    await page.goto('/tonight')

    const night = businessNight()
    const { data: bookings } = await admin.from('bookings').select('party_size, status').eq('branch_id', branchA).eq('night', night)
    const expectedBookings = bookings?.length ?? 0
    const expectedPeople = (bookings ?? []).reduce((s, b) => s + b.party_size, 0)
    const expectedArrived = (bookings ?? []).filter((b) => b.status === 'arrived').length

    const { count: toConfirm } = await admin.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchA).eq('status', 'pending_confirm')
    const { data: pendingW } = await admin.from('withdrawals').select('deposit_id').eq('branch_id', branchA).eq('status', 'pending')
    const expectedWithdraw = new Set((pendingW ?? []).map((w) => w.deposit_id)).size

    // each KPI cell is one <a> (Metric has an href) — scope the value check to its own cell
    // so metrics that happen to share a number never satisfy the wrong assertion.
    const bookingsCell = page.locator('a', { hasText: 'จองคืนนี้' })
    await expect(bookingsCell).toContainText(String(expectedBookings))
    await expect(bookingsCell).toContainText(`${expectedPeople} คน · มาแล้ว ${expectedArrived} โต๊ะ`)

    const toConfirmCell = page.locator('a', { hasText: 'รอ bar ยืนยันเหล้า' })
    await expect(toConfirmCell).toContainText(String(toConfirm ?? 0))

    const withdrawCell = page.locator('a', { hasText: 'คำขอเบิก' })
    await expect(withdrawCell).toContainText(String(expectedWithdraw))

    await expect(page.getByText('ใกล้หมดอายุ 7 วัน', { exact: true })).toBeVisible()
  })

  test('P2-A3-04 pending work: confirm/withdraw/LINE-request rows link to the deposit', async ({ page }) => {
    await page.goto('/tonight')
    const confirmRow = page.getByTestId('tonight-task-confirm').first()
    await expect(confirmRow).toBeVisible()
    await confirmRow.click()
    await expect(page).toHaveURL(new RegExp(`/deposits/${toConfirmDep.id}`))

    await page.goto('/tonight')
    const withdrawRow = page.getByTestId('tonight-task-withdraw').first()
    await expect(withdrawRow).toBeVisible()
    await withdrawRow.click()
    await expect(page).toHaveURL(new RegExp(`/deposits/${withdrawDep.id}`))

    await page.goto('/tonight')
    const requestRow = page.getByTestId('tonight-task-request').first()
    await expect(requestRow).toBeVisible()
    await requestRow.click()
    await expect(page).toHaveURL(new RegExp(`/deposits/${lineRequestDep.id}`))
  })

  test('P2-A3-08 on a phone: no sideways scroll; a long task row truncates and keeps its badge, in its group hue (R-047)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tonight')
    await expect(page.getByTestId('tonight-task-withdraw').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    const hues = [['confirm', 'text-status-progress'], ['withdraw', 'text-status-violet'], ['request', 'text-status-info']] as const
    for (const [kind, hue] of hues) {
      const chip = page.getByTestId(`tonight-task-${kind}`).first().locator('.chip')
      await expect(chip).toHaveClass(new RegExp(hue))
      const box = await chip.boundingBox()
      expect(box!.x + box!.width, `${kind} badge inside the screen`).toBeLessThanOrEqual(390)
    }
    await expect(page.locator('a', { hasText: 'คำขอเบิก' }).locator('.text-status-violet')).toBeVisible()
  })
})

test.describe('staff', () => {
  test.use({ storageState: as('staff') })

  test('P2-A3-02 staff: the รอ bar ยืนยันเหล้า KPI is hidden', async ({ page }) => {
    await page.goto('/tonight')
    await expect(page.getByText('รอ bar ยืนยันเหล้า', { exact: true })).toHaveCount(0)
    await expect(page.getByText('คำขอเบิก', { exact: true })).toBeVisible()
  })

  test('P2-A3-03 tonight bookings list: time, unassigned table, name/party, code, มาแล้ว check-in', async ({ page }) => {
    await page.goto('/tonight')
    const row = page.locator('[data-testid="tonight-booking-row"]', { hasText: confirmedBookingCode })
    await expect(row).toBeVisible()
    await expect(row.getByText('20:00', { exact: true })).toBeVisible()
    await expect(row.getByText('ยังไม่จัดโต๊ะ', { exact: false })).toBeVisible()
    await expect(row.getByText(`${RUN} คุณจอง`, { exact: false })).toBeVisible()
    await expect(row.getByText('4 คน', { exact: false })).toBeVisible()

    const checkin = page.getByTestId(`checkin-${confirmedBookingId}`)
    await expect(checkin).toBeVisible()
    await checkin.click()
    await expect(checkin).toHaveCount(0, { timeout: 15000 })
    const { data } = await adminDb().from('bookings').select('status').eq('id', confirmedBookingId).single()
    expect(data?.status).toBe('arrived')
  })

  test('P2-A3-05 expiring soon: ≤7 days with a badge อีก N วัน', async ({ page }) => {
    await page.goto('/tonight')
    await expect(page.getByText('ใกล้หมดอายุ', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('อีก 4 วัน', { exact: true })).toBeVisible()
  })

  test('P2-A3-06 scan: type a DEP code → item, customer, remaining, expiry, status + open/withdraw', async ({ page }) => {
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(scanDep.code)
    await page.getByRole('button', { name: 'ค้นหา', exact: true }).click()
    const card = page.getByTestId('scan-result-deposit')
    await expect(card).toBeVisible()
    await expect(card.getByText('Johnnie Walker Black Label', { exact: false })).toBeVisible()
    await expect(card.getByText('ลูกค้า', { exact: true })).toBeVisible()
    await expect(card.getByText('75%', { exact: false })).toBeVisible() // avg of 100/50
    await expect(page.getByTestId('scan-deposit-open')).toBeVisible()
    await expect(page.getByTestId('scan-deposit-withdraw')).toBeVisible()
    await page.getByTestId('scan-deposit-withdraw').click()
    await expect(page).toHaveURL(new RegExp(`/deposits/${scanDep.id}\\?open=withdraw`))
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('P2-A3-07 scan a branch-B deposit code shows "not found"', async ({ page }) => {
    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(branchBDep.code)
    await page.getByRole('button', { name: 'ค้นหา', exact: true }).click()
    await expect(page.getByText(`ไม่พบการจองหรือรายการฝากที่ตรงกับ "${branchBDep.code}"`, { exact: true })).toBeVisible()
  })

  test('P2-A3-09 scan: a booking code brings up the night as tiles while typing; the whole code leaves one; a tile opens the booking; ปิด returns to the tiles', async ({ page }) => {
    const night = businessNight()
    const code = `BK-${night.slice(5, 7)}${night.slice(8, 10)}`
    await page.goto('/scan')
    const box = page.getByTestId('scan-input')
    const tiles = page.getByTestId('booking-tile')

    await box.pressSequentially(code, { delay: 40 }) // no ค้นหา
    await expect(page.getByTestId('booking-board')).toHaveAttribute('data-night', night)
    await expect(tiles.and(page.locator(`[data-code="${confirmedBookingCode}"]`))).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`[?&]q=${code}(&|$)`))

    await box.pressSequentially(`-${confirmedBookingCode.split('-')[2]}`, { delay: 40 })
    await expect(tiles).toHaveCount(1)
    await tiles.first().click()
    const result = page.getByTestId('scan-result-booking')
    await expect(result).toContainText(confirmedBookingCode)
    await expect(page).toHaveURL(new RegExp(`[?&]b=${confirmedBookingId}`))
    await expect(page.getByTestId('booking-board')).toHaveCount(0)

    await result.getByRole('button', { name: 'ปิด', exact: true }).click()
    await expect(result).toHaveCount(0)
    await expect(tiles).toHaveCount(1)
    await expect(box).toHaveValue(confirmedBookingCode)

    // a deposit code still waits for ค้นหา — no tiles for it
    await box.fill(scanDep.code)
    await expect(page.getByTestId('booking-board')).toHaveCount(0)
    await box.fill('BK-09')
    await expect(page.getByTestId('scan-hint')).toContainText('พิมพ์วันที่ให้ครบ')
  })

  test('P2-A3-10 scan: จองวันนี้ · จองพรุ่งนี้ as tiles equal to SQL; the states narrow them; Back from a customer page returns to the open booking and its tiles', async ({ page }) => {
    const night = businessNight()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/scan')
    await page.getByTestId('scan-shortcut-today').click()
    await expect(page.getByTestId('scan-input')).toHaveValue(`BK-${night.slice(5, 7)}${night.slice(8, 10)}`)
    await expect(page.getByTestId('scan-shortcut-today')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('booking-board')).toHaveAttribute('data-night', night)

    const { data: tonight, error } = await adminDb().from('bookings').select('code, status').eq('branch_id', fixtureIds().branchA).eq('night', night).range(0, 999)
    expect(error, error?.message).toBeNull()
    const tiles = page.getByTestId('booking-tile')
    await expect(tiles).toHaveCount(tonight!.filter((b) => b.status !== 'cancelled' && b.status !== 'rejected').length)
    await page.getByTestId('board-filter-arrived').click()
    await expect(tiles).toHaveCount(tonight!.filter((b) => b.status === 'arrived').length)
    await page.getByTestId('board-filter-live').click()

    // a tile → the booking → ประวัติลูกค้า → ‹ สแกน QR: the same booking, and ปิด shows the tiles again
    await tiles.and(page.locator(`[data-code="${confirmedBookingCode}"]`)).click()
    await page.getByTestId('booking-customer-history').click()
    await expect(page).toHaveURL(/\/customers\//)
    await page.getByTestId('back-link').click()
    await expect(page).toHaveURL(new RegExp(`/scan\\?.*b=${confirmedBookingId}`))
    const result = page.getByTestId('scan-result-booking')
    await expect(result).toContainText(confirmedBookingCode)
    await result.getByRole('button', { name: 'ปิด', exact: true }).click()
    await expect(page.getByTestId('booking-board')).toHaveAttribute('data-night', night)

    await page.getByTestId('scan-shortcut-tomorrow').click()
    await expect(page.getByTestId('booking-board')).toHaveAttribute('data-night', addDays(night, 1))
    await expect(tiles.and(page.locator(`[data-code="${tomorrowBookingCode}"]`))).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
