import { randomInt } from 'node:crypto'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { RUN, cleanupRun, confirmAll, photo } from './fixtures/deposits'
import { businessNight } from '../../src/lib/date'

/**
 * P0-SHELL-15/16 — ‹ back returns to the page the user came from (R-050), named after it, and that
 * page comes back as it was left. One customer of our own (a fresh phone): a deposit waiting for
 * bar, one in store, and a booking tonight.
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const KEY = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`
const PHONE_NO = `${KEY.slice(0, 3)}-${KEY.slice(3, 6)}-${KEY.slice(6)}`
const NAME = `${RUN} คุณย้อนกลับ`

let waiting: { id: string; code: string }
let kept: { id: string; code: string }
let bk: { id: string; code: string }

async function take(qty: number) {
  const { data, error } = await dbAs('staff').rpc('create_deposit', {
    p_branch: fixtureIds().branchA,
    p_customer_name: NAME,
    p_item_name: 'Jameson',
    p_quantity: qty,
    p_photo_paths: [await photo('A')],
    p_customer_phone: PHONE_NO,
    p_table: 'C1',
  })
  expect(error, error?.message).toBeNull()
  return data as { id: string; code: string }
}

test.beforeAll(async () => {
  waiting = await take(1)
  kept = await take(1)
  await confirmAll(kept.id, [100])
  const { data, error } = await dbAs('staff').rpc('create_booking', {
    p_branch: fixtureIds().branchA,
    p_night: businessNight(),
    p_slot: '21:00:00',
    p_party: 2,
    p_name: NAME,
    p_phone: PHONE_NO,
  })
  expect(error, error?.message).toBeNull()
  bk = data as { id: string; code: string }
})

test.afterAll(async () => {
  await cleanupRun()
  await adminDb().from('bookings').delete().eq('branch_id', fixtureIds().branchA).like('name', `${RUN}%`)
})

/** /scan → type the booking code → ประวัติลูกค้า → ‹ สแกน QR → the same booking again. */
async function scanThereAndBack(page: Page) {
  await page.goto('/scan')
  await page.getByTestId('scan-input').fill(bk.code)
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click()
  await expect(page.getByTestId('scan-result-booking')).toContainText(bk.code)
  // the typed code rides along too (?q=, R-052)
  await expect(page).toHaveURL(new RegExp(`/scan\\?.*b=${bk.id}`))
  await page.getByTestId('booking-customer-history').click()
  await expect(page).toHaveURL(new RegExp(`/customers/p-${KEY}$`))
  const back = page.getByTestId('back-link')
  await expect(back).toHaveText('‹ สแกน QR')
  await back.click()
  await expect(page).toHaveURL(new RegExp(`/scan\\?.*b=${bk.id}`))
  await expect(page.getByTestId('scan-result-booking')).toContainText(bk.code)
}

test.describe('staff', () => {
  test.use({ storageState: as('staff') })

  test('P0-SHELL-15 from a scan: ‹ สแกน QR returns to the same scan result', async ({ page }) => {
    await scanThereAndBack(page)
  })

  test('P0-SHELL-15 from a filtered list: ‹ ลูกค้า returns to the list with its filter', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/customers?filter=in_store&q=${KEY}`)
    await page.getByTestId('customer-row').first().click()
    await expect(page).toHaveURL(new RegExp(`/customers/p-${KEY}$`))
    await expect(page.getByTestId('back-link')).toHaveText('‹ ลูกค้า')
    // a deposit from the history, then back twice: the customer, then the list
    await page.getByTestId('customer-deposit-row').filter({ hasText: kept.code }).click()
    await expect(page).toHaveURL(new RegExp(`/deposits/${kept.id}$`))
    await expect(page.getByTestId('back-link')).toHaveText('‹ ประวัติลูกค้า')
    await page.getByTestId('back-link').click()
    await expect(page).toHaveURL(new RegExp(`/customers/p-${KEY}$`))
    await expect(page.getByTestId('back-link')).toHaveText('‹ ลูกค้า')
    await page.getByTestId('back-link').click()
    await expect(page).toHaveURL(new RegExp(`/customers\\?filter=in_store&q=${KEY}$`))
    await expect(page.getByTestId('customers-filter-in_store')).toHaveAttribute('aria-current', 'page')
  })

  test('P0-SHELL-15 from a booking sheet: Back reopens the same sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/bookings?night=${businessNight()}&view=list`)
    await page.getByTestId('booking-list').getByRole('button').filter({ hasText: bk.code }).first().click()
    await expect(page.getByTestId('booking-sheet')).toHaveAttribute('data-booking-id', bk.id)
    await expect(page).toHaveURL(new RegExp(`[?&]b=${bk.id}`))
    await page.getByTestId('booking-customer-history').click()
    await expect(page).toHaveURL(new RegExp(`/customers/p-${KEY}$`))
    await expect(page.getByTestId('back-link')).toHaveText('‹ จองโต๊ะ')
    await page.getByTestId('back-link').click()
    await expect(page).toHaveURL(new RegExp(`/bookings\\?.*b=${bk.id}`))
    await expect(page.getByTestId('booking-sheet')).toHaveAttribute('data-booking-id', bk.id)
  })

  test('P0-SHELL-15 opened directly: ‹ goes to the parent list', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: as('staff') })
    const page = await ctx.newPage()
    await page.goto(`/deposits/${kept.id}`)
    const back = page.getByTestId('back-link')
    await expect(back).toHaveAttribute('data-back', 'parent')
    await expect(back).toHaveText('‹ ฝากเหล้า')
    await back.click()
    await expect(page).toHaveURL(/\/deposits$/)
    await ctx.close()
  })

  test('P0-SHELL-16 without the Navigation API the session trail finds the way back', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: as('staff') })
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'navigation', { value: undefined, configurable: true })
    })
    const page = await ctx.newPage()
    expect(await page.evaluate(() => (window as Window & { navigation?: unknown }).navigation)).toBeUndefined()
    await scanThereAndBack(page)
    await ctx.close()
  })
})

test.describe('bar', () => {
  test.use({ storageState: as('bar') })

  test('P0-SHELL-15 from tonight: ‹ คืนนี้ returns to tonight', async ({ page }) => {
    await page.goto('/tonight')
    await page.getByTestId('tonight-task-confirm').filter({ hasText: NAME }).first().click()
    await expect(page).toHaveURL(new RegExp(`/deposits/${waiting.id}$`))
    await expect(page.getByTestId('back-link')).toHaveText('‹ คืนนี้')
    await page.getByTestId('back-link').click()
    await expect(page).toHaveURL(/\/tonight$/)
  })
})
