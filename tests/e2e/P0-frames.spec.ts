import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { BRANCH_A_CODE } from './fixtures/users'
import { cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import { signCustomerToken } from './fixtures/p2c-token'
import { addDays, businessNight } from '../../src/lib/date'

/**
 * P0-UI-05 — every button has a visible edge (owner, R-035): a border, a fill, a gradient or a
 * shadow ring. A bare word beside a filled button does not read as a button — "ปฏิเสธ" next to
 * "ยืนยัน + จัดโต๊ะ" raised it. Swept on every staff page and every LIFF page, with their dialogs
 * and sheets open. Not buttons, so left out: the sidebar and bottom nav (<nav> menus), toasts,
 * a chip's own ✕, the on/off switch and full-width list rows (a button alone in its <li>).
 */
test.describe.configure({ mode: 'serial' })

const RUN = `E2EFR-${Date.now().toString(36)}`
const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }
let inStoreId = ''
let pendingId = ''
let bookingCode = ''
let customerId = ''

/** Every visible control on the page that shows no edge at all. */
async function unframed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const alpha = (c: string) => {
      if (!c || c === 'transparent') return 0
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return 1
      const parts = m[1].split(/[\s,/]+/).filter(Boolean)
      return parts.length > 3 ? parseFloat(parts[3]) : 1
    }
    const framed = (el: Element) => {
      const s = getComputedStyle(el)
      const border = ['top', 'right', 'bottom', 'left'].some(
        (d) => parseFloat(s.getPropertyValue(`border-${d}-width`)) >= 1 && s.getPropertyValue(`border-${d}-style`) !== 'none' && alpha(s.getPropertyValue(`border-${d}-color`)) > 0.05,
      )
      return border || alpha(s.backgroundColor) > 0.05 || s.backgroundImage !== 'none' || s.boxShadow !== 'none'
    }
    const out: string[] = []
    for (const el of document.querySelectorAll('button, summary, a[class*="btn-"], a.cx-btn, a.tab, .sec-head a')) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4 || getComputedStyle(el).visibility === 'hidden') continue
      if (el.closest('nav, [data-sonner-toaster], .chip, .tg')) continue
      const li = el.parentElement
      if (li?.tagName === 'LI' && li.children.length === 1) continue
      if (!framed(el)) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`)
    }
    return out
  })
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  // skeletons are pulsing divs (a working printer's icon pulses too — an svg, left alone)
  await expect(page.locator('[data-testid="cx-skeleton"], [data-testid="cx-loading"], div.animate-pulse')).toHaveCount(0)
}

test.beforeAll(async () => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  customerId = me.id
  // in store, linked to the customer (withdraw sheet); one waiting for the bar (confirm / reject)
  const d = await mustCreate('staff', { qty: 2, customerId: me.id })
  await confirmAll(d.id, [100, 60])
  inStoreId = d.id
  pendingId = (await mustCreate('staff', { qty: 1 })).id
  // a pending booking of this customer three nights on (the staff รอยืนยัน row, the LIFF cancel)
  const { data, error } = await adminDb().rpc('create_booking', {
    p_branch: branchA,
    p_night: addDays(businessNight(), 3),
    p_slot: '21:00:00',
    p_party: 2,
    p_name: `${RUN} frames`,
    p_customer_id: me.id,
  } as never)
  expect(error, error?.message).toBeNull()
  bookingCode = (data as { code: string }).code
  const { error: upErr } = await adminDb().from('bookings').update({ status: 'pending' }).eq('code', bookingCode).eq('branch_id', branchA)
  expect(upErr, upErr?.message).toBeNull()
})

test.afterAll(async () => {
  await adminDb().from('bookings').delete().like('name', `${RUN}%`)
  await cleanupRun()
  await cleanupCustomers()
})

async function pin(context: BrowserContext, branchId: string) {
  await context.addCookies([{ name: 'sis_branch', value: branchId, url: BASE_URL }])
}

const OWNER_PAGES = [
  '/overview', '/reports', '/deposits', '/deposits/new', '/bookings', '/bookings?view=list', '/scan',
  '/settings/branch', '/settings/booking', '/settings/tables', '/settings/items', '/settings/users', '/settings/line', '/me',
]

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  for (const [name, viewport] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
    test(`P0-UI-05 every staff button has a frame — pages, dialogs and sheets (${name})`, async ({ page, context }) => {
      test.setTimeout(240_000)
      await pin(context, fixtureIds().branchA)
      await page.setViewportSize(viewport)
      const misses: string[] = []
      const sweep = async (where: string) => {
        for (const m of await unframed(page)) misses.push(`${where} · ${m}`)
      }

      for (const path of [...OWNER_PAGES, `/deposits/${inStoreId}`, `/deposits/${pendingId}`]) {
        await page.goto(path)
        await settle(page)
        await sweep(path)
      }

      // dialogs and sheets
      await page.goto(`/deposits/${inStoreId}`)
      await page.getByTestId('action-extend').click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await sweep('extend dialog')
      await page.keyboard.press('Escape')

      await page.goto('/bookings')
      await settle(page)
      await page.locator(`[data-testid="pending-row"][data-code="${bookingCode}"]`).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await settle(page)
      await sweep('booking sheet')
      await page.keyboard.press('Escape')

      await page.locator('[data-testid="bell-button"]:visible').click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await settle(page)
      await sweep('bell')
      await page.keyboard.press('Escape')

      if (name === 'phone') {
        await page.getByRole('button', { name: 'เพิ่มเติม' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await sweep('more sheet')
        await page.keyboard.press('Escape')
      }

      expect(misses).toEqual([])
    })
  }
})

test.describe('bar', () => {
  test.use({ storageState: as('bar') })
  test('P0-UI-05 every button on the bar\'s own pages has a frame', async ({ page }) => {
    await page.setViewportSize(PHONE)
    const misses: string[] = []
    for (const path of ['/tonight', '/deposits', '/bookings', `/deposits/${pendingId}`]) {
      await page.goto(path)
      await settle(page)
      for (const m of await unframed(page)) misses.push(`${path} · ${m}`)
    }
    expect(misses).toEqual([])
  })
})

test('P0-UI-05 every LIFF button has a frame — pages and sheets, night and cream', async ({ page }) => {
  test.setTimeout(180_000)
  const { branchA } = fixtureIds()
  const token = signCustomerToken(customerId, branchA)
  await page.addInitScript((t) => {
    ;(window as unknown as { __SIS_LIFF_TEST__?: { customerToken: string } }).__SIS_LIFF_TEST__ = { customerToken: t }
  }, token)
  await page.setViewportSize(PHONE)
  const base = `/liff/${BRANCH_A_CODE.toLowerCase()}`
  const misses: string[] = []
  const sweep = async (where: string) => {
    for (const m of await unframed(page)) misses.push(`${where} · ${m}`)
  }

  for (const theme of ['night', 'cream'] as const) {
    for (const path of ['', '/book', '/tickets', `/ticket/${bookingCode}`, '/deposit']) {
      await page.goto(`${base}${path}`)
      await settle(page)
      if (theme === 'cream' && (await page.locator('.cx').getAttribute('data-cx-theme')) !== 'light') {
        await page.getByTestId('cx-theme-toggle').click()
        await expect(page.locator('.cx')).toHaveAttribute('data-cx-theme', 'light')
      }
      await sweep(`${theme} ${path || '/'}`)
    }

    await page.goto(base)
    await settle(page)
    await page.getByTestId('cx-locale-trigger').click()
    await expect(page.getByTestId('cx-locale-sheet')).toBeVisible()
    await sweep(`${theme} language sheet`)
    await page.keyboard.press('Escape')

    await page.getByTestId('cx-withdraw-open').first().click()
    await expect(page.getByTestId('cx-withdraw-sheet')).toBeVisible()
    await sweep(`${theme} withdraw sheet`)
    await page.keyboard.press('Escape')

    await page.goto(`${base}/ticket/${bookingCode}`)
    await settle(page)
    await page.getByTestId('cx-ticket-cancel').click()
    await expect(page.getByTestId('cx-ticket-cancel-dialog')).toBeVisible()
    await sweep(`${theme} cancel dialog`)
    await page.keyboard.press('Escape')
  }

  expect(misses).toEqual([])
})
