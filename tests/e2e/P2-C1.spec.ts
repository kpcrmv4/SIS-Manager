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
  await expect(page.getByText(`SIS Music Bar · ${BRANCH_A_NAME}`)).toBeVisible()
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
  await expect(page.getByText(`SIS Music Bar · ${BRANCH_A_NAME}`)).toBeVisible()

  await page.getByTestId('cx-locale-trigger').click()
  await page.getByTestId('cx-locale-en').click()
  await expect(page.getByRole('heading', { name: 'My bottles' })).toBeVisible()

  const { adminDb } = await import('./fixtures/db')
  const { data } = await adminDb().from('customers').select('locale').eq('id', customer.id).single()
  expect(data?.locale).toBe('en')
})

test('P2-C1-04 the theme toggle switches to cream and back', async ({ page }) => {
  const { branchA } = fixtureIds()
  const customer = await makeCustomer()
  const token = signCustomerToken(customer.id, branchA)
  await withCustomerDouble(page, token)

  await page.goto(`/liff/${BRANCH_A_CODE.toLowerCase()}`)
  const root = page.locator('.cx')
  await expect(root).toBeVisible()
  await expect(root).not.toHaveAttribute('data-cx-theme', 'light')

  await page.getByTestId('cx-theme-toggle').click()
  await expect(root).toHaveAttribute('data-cx-theme', 'light')
  const bg = await root.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgb(251, 246, 238)')

  await page.getByTestId('cx-theme-toggle').click()
  await expect(root).not.toHaveAttribute('data-cx-theme', 'light')
})

test('P2-C1-05 every /api/customer/* route answers 401 JSON without a credential', async ({ request }) => {
  // extended with more routes as P2-C2/P2-C3 add them (this file is shared across all three tasks)
  const routes: { method: 'GET' | 'POST' | 'PATCH'; path: string }[] = [
    { method: 'POST', path: `/api/customer/session?branch=${BRANCH_A_CODE.toLowerCase()}` },
    { method: 'PATCH', path: `/api/customer/profile?branch=${BRANCH_A_CODE.toLowerCase()}` },
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
