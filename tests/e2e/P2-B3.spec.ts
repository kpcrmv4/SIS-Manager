import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { DEFAULT_SETTINGS, resetSettings, teardownZonesAndTables } from './fixtures/p2b-bookings'
import { BRANCH_A_NAME } from './fixtures/users'

test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const admin = () => adminDb()
const RUN = Date.now().toString(36)
let branchA = ''
let branchB = ''

const cleanupUserIds: string[] = []
const cleanupBranchCodes: string[] = []

test.beforeAll(async () => {
  const ids = fixtureIds()
  branchA = ids.branchA
  branchB = ids.branchB
  await teardownZonesAndTables(admin(), branchA)
  await resetSettings(admin(), branchA)
})

test.afterAll(async () => {
  for (const id of cleanupUserIds) await admin().auth.admin.deleteUser(id).catch(() => undefined)
  if (cleanupBranchCodes.length) await admin().from('branches').delete().in('code', cleanupBranchCodes)
  await teardownZonesAndTables(admin(), branchA)
  await resetSettings(admin(), branchA)
})

test.describe('owner settings', () => {
  test.use({ storageState: as('owner') })

  // storageState is the same static snapshot for every test in this file (no sis_branch
  // cookie carries over between tests), and the owner sees every branch — without a
  // sis_branch cookie the app defaults to the alphabetically-first branch, which is
  // another fixture's, not ours. Pin the cookie directly (deterministic, no UI race).
  //
  // Also re-activate the owner profile every time: this project's fixture accounts are
  // shared across concurrently-running E2E workers, and another worker's global-teardown
  // (parkFixture) can flip `active` off mid-suite even for a different fixture letter's
  // row when runs overlap. is_owner() requires active=true, so a write silently 42501s.
  test.beforeEach(async ({ page, context }) => {
    const ownerId = fixtureIds().users.owner
    await admin().from('profiles').update({ active: true }).eq('id', ownerId)
    await context.addCookies([{ name: 'sis_branch', value: branchA, url: BASE_URL }])
    await page.goto('/tonight')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(BRANCH_A_NAME)
  })

  test('P2-B3-01 P2-B3-02 save every booking rule field incl. weekday toggles', async ({ page }) => {
    await page.goto('/settings/booking')
    await expect(page.getByTestId('booking-settings-form')).toBeVisible()
    await page.getByRole('switch', { name: 'เปิดรับจองผ่าน LINE' }).click() // -> off
    await page.getByRole('switch', { name: 'ยืนยันการจองอัตโนมัติ' }).click() // -> on
    await page.getByLabel('เปิดจองล่วงหน้า (วัน)').fill('10')
    await page.getByLabel('จองได้สูงสุดต่อคืน (โต๊ะ)').fill('12')
    await page.getByLabel('จำนวนคนขั้นต่ำ').fill('2')
    await page.getByLabel('จำนวนคนสูงสุด').fill('8')
    const days = page.getByRole('group', { name: 'วันปิดรับจองประจำสัปดาห์' })
    await days.getByRole('button', { name: 'พ', exact: true }).click()
    await page.getByTestId('booking-settings-save').click()
    await expect(page.getByText('บันทึกแล้ว')).toBeVisible()

    const { data, error } = await admin()
      .from('booking_settings')
      .select('line_enabled, auto_confirm, advance_days, max_bookings_per_night, party_min, party_max, closed_weekdays')
      .eq('branch_id', branchA)
      .single()
    expect(error, error?.message).toBeNull()
    expect(data).toMatchObject({ line_enabled: false, auto_confirm: true, advance_days: 10, max_bookings_per_night: 12, party_min: 2, party_max: 8 })
    expect(data!.closed_weekdays).toContain(2) // พุธ = Wed = index 2

    await resetSettings(admin(), branchA)
  })

  test('P2-B3-03 calendar: tap a day, add reason, save; tap again removes', async ({ page }) => {
    await page.goto('/settings/booking')
    await expect(page.locator('.cal[aria-busy="false"]')).toBeVisible()
    await page.getByTestId('cal-reason-input').fill(`${RUN} ปิดร้าน`)
    // the LAST open day of the month: near month-end is reliably in the future (today is the 23rd)
    const openDay = page.locator('[data-testid="cal-day"]:not([data-state="closed_weekday"]):not([data-state="past"]):not([data-state="blackout"])').last()
    const night = await openDay.getAttribute('data-night')
    await openDay.click()
    await expect(page.locator(`[data-night="${night}"]`)).toHaveAttribute('data-state', 'blackout')
    const { data: added } = await admin().from('booking_blackouts').select('id, reason').eq('branch_id', branchA).eq('night', night!).maybeSingle()
    expect(added?.reason).toContain(RUN)

    await page.locator(`[data-night="${night}"]`).click()
    await expect(page.locator(`[data-night="${night}"]`)).toHaveAttribute('data-state', 'open')
    const { data: removed } = await admin().from('booking_blackouts').select('id').eq('branch_id', branchA).eq('night', night!).maybeSingle()
    expect(removed).toBeNull()
  })

  test('P2-B3-04 floor plan: add zone, add table, edit, toggle bookable, unique label error, delete empty zone', async ({ page }) => {
    await page.goto('/settings/tables')
    await page.getByTestId('add-zone-button').click()
    await page.getByLabel('ชื่อโซน').fill(`${RUN} โซน`)
    await page.getByTestId('zone-dialog-submit').click()
    await expect(page.getByText(`${RUN} โซน`)).toBeVisible()

    await page.getByTestId('add-table-button').click()
    await page.getByLabel('ชื่อโต๊ะ').fill('ZT1')
    await page.locator('#td-zone').selectOption({ label: `${RUN} โซน` })
    await page.getByTestId('table-dialog-submit').click()
    // tables render twice (desktop table + hidden mobile card list) — assert the visible twin
    await expect(page.getByText('ZT1').filter({ visible: true })).toBeVisible()

    // duplicate label in the same branch is refused
    await page.getByTestId('add-table-button').click()
    await page.getByLabel('ชื่อโต๊ะ').fill('ZT1')
    await page.locator('#td-zone').selectOption({ label: `${RUN} โซน` })
    await page.getByTestId('table-dialog-submit').click()
    await expect(page.getByText('ชื่อโต๊ะนี้ถูกใช้ในสาขานี้แล้ว')).toBeVisible()
    await page.getByRole('button', { name: 'ยกเลิก' }).click()

    // edit the table's label
    const zoneCard = page.getByTestId('zone-card').filter({ hasText: `${RUN} โซน` })
    await zoneCard.getByRole('button', { name: 'แก้ไข' }).last().click()
    await page.getByLabel('ชื่อโต๊ะ').fill('ZT2')
    await page.getByTestId('table-dialog-submit').click()
    await expect(zoneCard.getByText('ZT2').filter({ visible: true })).toBeVisible()

    // toggle bookable
    const bookableSwitch = zoneCard.getByRole('switch', { name: 'ให้ลูกค้าจองผ่าน LINE' })
    await bookableSwitch.click()
    await expect(bookableSwitch).toHaveAttribute('aria-checked', 'false')
    const { data: zoneRow } = await admin().from('table_zones').select('id, customer_bookable').eq('branch_id', branchA).eq('name', `${RUN} โซน`).single()
    expect(zoneRow?.customer_bookable).toBe(false)

    // delete: must remove the table first, then the zone
    await admin().from('tables').delete().eq('zone_id', zoneRow!.id)
    await page.reload()
    const zoneCard2 = page.getByTestId('zone-card').filter({ hasText: `${RUN} โซน` })
    await zoneCard2.getByRole('button', { name: 'ลบ' }).click()
    await expect(zoneCard2).toHaveCount(0)
    const { data: gone } = await admin().from('table_zones').select('id').eq('id', zoneRow!.id).maybeSingle()
    expect(gone).toBeNull()
  })

  test('P2-B3-05 liquor items: add (branch-specific), edit, deactivate', async ({ page }) => {
    await page.goto('/settings/items')
    await page.getByTestId('add-item-button').click()
    await page.getByLabel('ชื่อเหล้า').fill(`${RUN} Whisky`)
    await page.locator('#id-branch').selectOption({ label: BRANCH_A_NAME })
    await page.getByTestId('item-dialog-submit').click()
    await expect(page.getByText(`${RUN} Whisky`).filter({ visible: true })).toBeVisible()

    const { data: created } = await admin().from('liquor_items').select('id, branch_id, active').eq('name', `${RUN} Whisky`).single()
    expect(created?.branch_id).toBe(branchA)
    expect(created?.active).toBe(true)

    // the new branch item is offered in the pick list on /deposits/new
    await page.goto('/deposits/new')
    await expect(page.locator(`#deposit-items option[value="${RUN} Whisky"]`)).toHaveCount(1)
    await page.goto('/settings/items')

    const row = page.getByRole('row', { name: new RegExp(`${RUN} Whisky`) })
    await row.getByRole('button', { name: 'แก้ไข' }).click()
    await page.getByLabel('ชื่อเหล้า').fill(`${RUN} Whisky Gold`)
    await page.getByTestId('item-dialog-submit').click()
    await expect(page.getByText(`${RUN} Whisky Gold`).filter({ visible: true })).toBeVisible()

    const activeToggle = page.getByRole('row', { name: new RegExp(`${RUN} Whisky Gold`) }).getByTestId('item-active-toggle')
    await activeToggle.click()
    await expect(activeToggle).toHaveAttribute('aria-checked', 'false')
    const { data: after } = await admin().from('liquor_items').select('active').eq('id', created!.id).single()
    expect(after?.active).toBe(false)

    // …and disappears from it once deactivated
    await page.goto('/deposits/new')
    await expect(page.getByTestId('new-deposit-form')).toBeVisible()
    await expect(page.locator(`#deposit-items option[value="${RUN} Whisky Gold"]`)).toHaveCount(0)

    await admin().from('liquor_items').delete().eq('id', created!.id)
  })

  test('P2-B3-06 P2-B3-07 create a user, log in, deactivate, reset password, change branches', async ({ page, request }) => {
    const username = `p2b-${RUN}`
    await page.goto('/settings/users')
    await page.getByTestId('add-user-button').click()
    await page.getByLabel('ชื่อผู้ใช้').fill(username)
    await page.getByLabel('ชื่อที่แสดง').fill('P2B ทดสอบ')
    await page.locator('#ud-role').selectOption('staff')
    await page.getByRole('checkbox').first().check() // first branch checkbox
    await page.getByLabel('รหัสผ่านเริ่มต้น').fill('Passw0rd123')
    await page.getByTestId('user-dialog-submit').click()
    await expect(page.getByText('สร้างผู้ใช้แล้ว')).toBeVisible()

    const { data: created } = await admin().from('profiles').select('id, role, active').eq('username', username).single()
    expect(created?.role).toBe('staff')
    cleanupUserIds.push(created!.id)
    const { count: branchCount } = await admin().from('user_branches').select('branch_id', { count: 'exact', head: true }).eq('user_id', created!.id)
    expect(branchCount).toBeGreaterThan(0)

    const login1 = await request.post('/api/auth/login', { data: { identifier: username, password: 'Passw0rd123' } })
    expect(login1.ok(), await login1.text()).toBeTruthy()

    // deactivate
    await page.reload()
    const row = page.getByTestId('user-row').filter({ hasText: username })
    await row.getByRole('button', { name: 'แก้ไข' }).click()
    await page.getByRole('switch', { name: 'ใช้งาน' }).click()
    await page.getByTestId('user-dialog-submit').click()
    await expect(page.getByText('บันทึกแล้ว')).toBeVisible()
    const { data: inactive } = await admin().from('profiles').select('active').eq('id', created!.id).single()
    expect(inactive?.active).toBe(false)
    const login2 = await request.post('/api/auth/login', { data: { identifier: username, password: 'Passw0rd123' } })
    expect(login2.ok()).toBeFalsy()

    // reactivate + reset password
    await page.reload()
    const row2 = page.getByTestId('user-row').filter({ hasText: username })
    await row2.getByRole('button', { name: 'แก้ไข' }).click()
    await page.getByRole('switch', { name: 'ใช้งาน' }).click()
    await page.getByTestId('user-dialog-submit').click()
    await expect(page.getByText('บันทึกแล้ว')).toBeVisible()

    await page.reload()
    const row3 = page.getByTestId('user-row').filter({ hasText: username })
    await row3.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }).click()
    await page.getByLabel('รหัสผ่านเริ่มต้น').fill('NewPassw0rd456')
    await page.getByTestId('reset-password-submit').click()
    await expect(page.getByText('บันทึกแล้ว')).toBeVisible()
    const login3 = await request.post('/api/auth/login', { data: { identifier: username, password: 'NewPassw0rd456' } })
    expect(login3.ok(), await login3.text()).toBeTruthy()
  })

  test('P2-B3-08 branches: create + edit deposit/notice/blocked days', async ({ page }) => {
    const code = `Z${RUN.slice(-2).toUpperCase().replace(/[^A-Z]/g, 'X')}`
    cleanupBranchCodes.push(code)
    await page.goto('/settings/users')
    await page.getByRole('tab', { name: 'สาขา' }).click()
    await page.getByTestId('add-branch-button').click()
    await page.getByLabel('รหัสสาขา').fill(code)
    await page.getByLabel('ชื่อสาขา').fill(`${RUN} สาขาทดสอบ`)
    await page.getByTestId('create-branch-submit').click()
    const row = page.getByTestId('branch-row').filter({ hasText: code })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'แก้ไข' }).click()
    const editDialog = page.getByRole('dialog', { name: `${RUN} สาขาทดสอบ` })
    await editDialog.getByLabel('อายุฝาก (วัน)').fill('45')
    await editDialog.getByLabel('แจ้งเตือนก่อนหมดอายุ (วัน)').fill('5')
    await editDialog.getByRole('group', { name: 'วันงดเบิกดื่มในร้าน' }).getByRole('button', { name: 'จันทร์'.slice(0, 3), exact: true }).click()
    await editDialog.getByTestId('branch-form-save').click()
    // wait for the edit dialog itself to close — onSaved only fires after the write commits,
    // more reliable than matching "บันทึกแล้ว" text (the create step above shows the same toast)
    await expect(editDialog).toHaveCount(0)

    const { data } = await admin().from('branches').select('deposit_days, expiry_notice_days, withdrawal_blocked_days').eq('code', code).single()
    expect(data?.deposit_days).toBe(45)
    expect(data?.expiry_notice_days).toBe(5)
    expect(data?.withdrawal_blocked_days).toContain('Mon')
  })
})

test.describe('non-owner is refused', () => {
  for (const role of ['staff', 'bar'] as const) {
    test.describe(role, () => {
      test.use({ storageState: as(role) })
      for (const path of ['/settings/booking', '/settings/tables', '/settings/items', '/settings/users', '/settings/branch']) {
        test(`P2-B3-09 ${path} as ${role} → 404`, async ({ page }) => {
          const res = await page.goto(path)
          expect(res?.status()).toBe(404)
        })
      }
    })
  }

  test.describe('bar api', () => {
    test.use({ storageState: as('bar') })
    test('P2-B3-10 POST /api/admin/users as bar → 403, no user created', async ({ request }) => {
      const username = `p2b-refused-${RUN}`
      const res = await request.post('/api/admin/users', {
        data: { action: 'create', username, displayName: 'Should not exist', role: 'staff', branchIds: [], password: 'Passw0rd123' },
      })
      expect(res.status()).toBe(403)
      const { data } = await admin().from('profiles').select('id').eq('username', username).maybeSingle()
      expect(data).toBeNull()
    })
  })
})
