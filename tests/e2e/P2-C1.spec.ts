import { expect, test } from '@playwright/test'
import { fixtureIds } from './fixtures/db'
import { BRANCH_A_CODE, BRANCH_A_NAME, BRANCH_B_CODE } from './fixtures/users'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import { signCustomerToken } from './fixtures/p2c-token'
import { BASE_URL } from './fixtures/env'

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  await cleanupCustomers()
})

/** Skips LIFF entirely — the shell reads this instead (CLAUDE.md customer rules, P2-C1). */
async function withCustomerDouble(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript((t) => {
    ;(window as unknown as { __SIS_LIFF_TEST__?: { customerToken: string } }).__SIS_LIFF_TEST__ = { customerToken: t }
  }, token)
}

test('P2-C1-01 a test LIFF double establishes a session and shows the branch header', async ({ page }) => {
  const { branchA } = fixtureIds()
  const customer = await makeCustomer()
  const token = signCustomerToken(customer.id, branchA)
  await withCustomerDouble(page, token)

  await page.goto(`/liff/${BRANCH_A_CODE.toLowerCase()}`)
  // the header names the branch alone — its name already carries the shop's
  await expect(page.getByTestId('cx-branch-name')).toHaveText(BRANCH_A_NAME)
  // the bottom nav only renders once the session status is 'ready' — the real proof, not just the header text
  await expect(page.getByTestId('cx-bottom-nav')).toBeVisible()
  await expect(page.getByTestId('cx-loading')).toHaveCount(0)
  await expect(page.getByTestId('cx-login-failed')).toHaveCount(0)

  const stored = await page.evaluate((code) => sessionStorage.getItem(`sis_cx_token_${code}`), BRANCH_A_CODE.toLowerCase())
  expect(stored).toBe(token)
})

test('P2-C1-02 an unknown branch code 404s', async ({ page }) => {
  const res = await page.goto('/liff/xxxxx')
  expect(res?.status()).toBe(404)
})

test('P2-C1-03 the locale picker switches UI strings and saves customers.locale', async ({ page }) => {
  const { branchA } = fixtureIds()
  const customer = await makeCustomer({ locale: 'th' })
  const token = signCustomerToken(customer.id, branchA)
  await withCustomerDouble(page, token)

  await page.goto(`/liff/${BRANCH_A_CODE.toLowerCase()}`)
  await expect(page.getByTestId('cx-branch-name')).toHaveText(BRANCH_A_NAME)

  await page.getByTestId('cx-locale-trigger').click()
  // the sheet fits its four languages — it once inherited the page root's full-screen height (R-035)
  const sheet = page.getByTestId('cx-locale-sheet')
  await expect(sheet).toBeVisible()
  expect((await sheet.boundingBox())!.height).toBeLessThan(420)
  await page.getByTestId('cx-locale-en').click()
  await expect(page.getByRole('heading', { name: 'My bottles' })).toBeVisible()

  const { adminDb } = await import('./fixtures/db')
  const { data } = await adminDb().from('customers').select('locale').eq('id', customer.id).single()
  expect(data?.locale).toBe('en')
})

test('P2-C1-04 the theme toggle switches to cream and back; sheets follow it', async ({ page }) => {
  const { branchA } = fixtureIds()
  const customer = await makeCustomer()
  const token = signCustomerToken(customer.id, branchA)
  await withCustomerDouble(page, token)

  await page.goto(`/liff/${BRANCH_A_CODE.toLowerCase()}`)
  const root = page.locator('.cx')
  await expect(root).toBeVisible()
  await expect(root).not.toHaveAttribute('data-cx-theme', 'light')
  // Davis's wine gradient by default (R-035), and a sheet on the dark wine surface
  expect(await root.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('rgb(156, 5, 18)')
  const sheet = page.getByTestId('cx-locale-sheet')
  await page.getByTestId('cx-locale-trigger').click()
  await expect(sheet).toHaveCSS('background-color', 'rgb(42, 11, 16)')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  await page.getByTestId('cx-theme-toggle').click()
  await expect(root).toHaveAttribute('data-cx-theme', 'light')
  const bg = await root.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgb(251, 246, 238)')
  // sheets portal into the themed root, so they turn cream too (they stayed dark before R-035)
  await page.getByTestId('cx-locale-trigger').click()
  await expect(sheet).toHaveCSS('background-color', 'rgb(255, 253, 248)')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  await page.getByTestId('cx-theme-toggle').click()
  await expect(root).not.toHaveAttribute('data-cx-theme', 'light')
})

test('P2-C1-05 every /api/customer/* route answers 401 JSON without a credential', async ({ request }) => {
  // extended with more routes as P2-C2/P2-C3 add them (this file is shared across all three tasks)
  const routes: { method: 'GET' | 'POST' | 'PATCH'; path: string }[] = [
    { method: 'POST', path: `/api/customer/session?branch=${BRANCH_A_CODE.toLowerCase()}` },
    { method: 'PATCH', path: `/api/customer/profile?branch=${BRANCH_A_CODE.toLowerCase()}` },
    { method: 'GET', path: `/api/customer/deposits?branch=${BRANCH_A_CODE.toLowerCase()}` },
    { method: 'POST', path: `/api/customer/withdrawals?branch=${BRANCH_A_CODE.toLowerCase()}` },
    { method: 'POST', path: `/api/customer/deposit-requests?branch=${BRANCH_A_CODE.toLowerCase()}` },
    { method: 'GET', path: `/api/customer/availability?branch=${BRANCH_A_CODE.toLowerCase()}&from=2026-01-01&to=2026-01-02` },
    { method: 'GET', path: `/api/customer/tables?branch=${BRANCH_A_CODE.toLowerCase()}&night=2026-01-01` },
    { method: 'GET', path: `/api/customer/bookings?branch=${BRANCH_A_CODE.toLowerCase()}` },
    { method: 'POST', path: `/api/customer/bookings?branch=${BRANCH_A_CODE.toLowerCase()}` },
    { method: 'POST', path: `/api/customer/bookings/00000000-0000-0000-0000-000000000000/cancel?branch=${BRANCH_A_CODE.toLowerCase()}` },
  ]
  for (const r of routes) {
    const res = await request.fetch(`${BASE_URL}${r.path}`, { method: r.method, data: {} })
    expect(res.status(), r.path).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthenticated' })
  }
})

test('P2-C1-06 a branch-A customer token is refused on branch B', async ({ request }) => {
  const { branchA } = fixtureIds()
  const customer = await makeCustomer()
  const token = signCustomerToken(customer.id, branchA)
  const res = await request.fetch(`${BASE_URL}/api/customer/session?branch=${BRANCH_B_CODE.toLowerCase()}`, {
    method: 'POST',
    headers: { 'X-Customer-Token': token },
    data: {},
  })
  expect(res.status()).toBe(401)
})

test('P2-C1-08 after switching to Thai, dates on the bookings list and the ticket are Thai (month + พ.ศ.)', async ({ page }) => {
  const { branchA } = fixtureIds()
  const customer = await makeCustomer({ locale: 'en' })
  const { adminDb } = await import('./fixtures/db')
  const { addDays, businessNight, formatLongDate, formatShortDate } = await import('../../src/lib/date')
  const night = addDays(businessNight(), 6)
  const { data: booking, error } = await adminDb().rpc('create_booking', {
    p_branch: branchA,
    p_night: night,
    p_slot: '19:30:00',
    p_party: 2,
    p_name: 'E2EC date locale',
    p_customer_id: customer.id,
  } as never)
  expect(error, error?.message).toBeNull()
  const code = (booking as { code: string }).code
  await withCustomerDouble(page, signCustomerToken(customer.id, branchA))

  const row = page.locator(`[data-testid="cx-booking-row"][data-code="${code}"]`)
  await page.goto(`/liff/${BRANCH_A_CODE.toLowerCase()}/tickets`)
  await expect(row).toContainText(formatShortDate(night, 'en'))

  // switch to Thai in the sheet — no new sign-in, the session's locale is still 'en'
  await page.getByTestId('cx-locale-trigger').click()
  await page.getByTestId('cx-locale-th').click()
  await expect(row).toContainText(formatShortDate(night, 'th'))
  // a Thai month name, and not the English rendering the session started with
  expect(formatShortDate(night, 'th')).toMatch(/[฀-๿]/)
  await expect(row).not.toContainText(formatShortDate(night, 'en'))

  await row.click()
  await expect(page.getByTestId('cx-ticket-date')).toHaveText(formatLongDate(night, 'th'))
  await adminDb().from('bookings').delete().eq('branch_id', branchA).eq('code', code)
})
