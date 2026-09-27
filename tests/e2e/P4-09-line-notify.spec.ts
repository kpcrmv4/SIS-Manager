import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'

/**
 * P4-09 — แจ้งเตือนอัตโนมัติทาง LINE (R-063): a kind the owner switched off is never queued; the
 * settings card switches it and shows the OA's quota. The fixture branch has no channel token, so
 * nothing queued here can reach LINE (L-015).
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)

async function setOff(off: string[]) {
  const { error } = await adminDb().from('branches').update({ line_notify_off: off }).eq('id', fixtureIds().branchA)
  expect(error, error?.message).toBeNull()
}

async function queued(depositId: string, kind: string) {
  const { count } = await adminDb().from('line_outbox').select('id', { count: 'exact', head: true }).eq('kind', kind).eq('payload->>deposit_id', depositId)
  return count ?? 0
}

test.afterAll(async () => {
  await setOff([])
  await cleanupRun()
  await cleanupCustomers()
})

test('P4-09-01 a kind switched off is never queued; switched back on it is; unknown kinds are refused', async () => {
  const me = await makeCustomer()
  await setOff(['deposit_confirmed'])
  const a = await mustCreate('staff', { qty: 1, customerId: me.id })
  await confirmAll(a.id, [100])
  expect(await queued(a.id, 'deposit_confirmed')).toBe(0)

  await setOff([])
  const b = await mustCreate('staff', { qty: 1, customerId: me.id })
  await confirmAll(b.id, [100])
  expect(await queued(b.id, 'deposit_confirmed')).toBe(1)

  const { error } = await adminDb().from('branches').update({ line_notify_off: ['bogus'] }).eq('id', fixtureIds().branchA)
  expect(error?.message).toContain('branches_line_notify_off_kinds')
})

test.describe('P4-09-02 the settings card', () => {
  test.use({ storageState: as('owner'), viewport: { width: 390, height: 844 } })

  test('P4-09-02 owner switches a message off and on; the quota says the branch has no token', async ({ page, context }) => {
    await context.addCookies([{ name: 'sis_branch', value: fixtureIds().branchA, url: BASE_URL }])
    await setOff([])
    await page.goto('/settings/branch')
    const card = page.getByTestId('line-notify')
    await expect(card).toBeVisible()
    await expect(page.getByTestId('line-quota')).toHaveAttribute('data-state', 'no_token')
    await expect(card.getByTestId('notify-row')).toHaveCount(13)

    const row = card.locator('[data-testid="notify-row"][data-kind="booking_confirmed"]')
    await expect(row).toHaveAttribute('data-on', 'true')
    await page.getByTestId('notify-switch-booking_confirmed').click()
    await expect(row).toHaveAttribute('data-on', 'false')
    await expect.poll(async () => (await adminDb().from('branches').select('line_notify_off').eq('id', fixtureIds().branchA).single()).data?.line_notify_off).toEqual(['booking_confirmed'])

    await page.reload()
    await expect(page.locator('[data-testid="notify-row"][data-kind="booking_confirmed"]')).toHaveAttribute('data-on', 'false')
    await page.getByTestId('notify-switch-booking_confirmed').click()
    await expect(page.locator('[data-testid="notify-row"][data-kind="booking_confirmed"]')).toHaveAttribute('data-on', 'true')
    await expect.poll(async () => (await adminDb().from('branches').select('line_notify_off').eq('id', fixtureIds().branchA).single()).data?.line_notify_off).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // (owner, 2026-09-27) the cards on this page sit 16px apart, none touching
    const gaps = await page.getByTestId('branch-settings').evaluate((el) => {
      const cards = [...el.querySelectorAll(':scope > *, :scope > #print > *')].filter((c) => c.id !== 'print').map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0)
      return cards.slice(1).map((r, i) => Math.round(r.top - cards[i].bottom))
    })
    expect(gaps.length).toBeGreaterThan(2)
    for (const g of gaps) expect(g).toBe(16)

    // (owner, 2026-09-27) the printer's state sits right of its title; how to install it unfolds here and in the manual
    const panel = page.getByTestId('print-status-panel')
    const title = await panel.locator('.sec-head').first().boundingBox()
    const badge = await panel.getByTestId('print-status-badge').boundingBox()
    expect(badge!.x).toBeGreaterThan(title!.x + title!.width)
    expect(Math.abs(badge!.y + badge!.height / 2 - (title!.y + title!.height / 2))).toBeLessThan(6)
    await page.getByTestId('print-install-help').locator('summary').click()
    await expect(page.getByTestId('print-install-help').locator('li')).toHaveCount(4)
    await page.getByTestId('print-install-manual').click()
    await page.waitForURL(/\/manual#branchSettings-install$/)
    await expect(page.locator('#branchSettings-install')).toContainText('วิธีติดตั้งเครื่องพิมพ์ที่ร้าน')
  })
})
