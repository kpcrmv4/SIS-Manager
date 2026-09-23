import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { SIGNED_IN_ROLES } from './fixtures/users'

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const PHONE = { width: 390, height: 844 }

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(sw).toBeLessThanOrEqual(iw)
}

test.describe('landing', () => {
  for (const [role, target] of [['staff', '/tonight'], ['bar', '/tonight'], ['owner', '/overview']] as const) {
    test.describe(role, () => {
      test.use({ storageState: as(role) })
      test(`P0-SHELL-0${role === 'staff' ? 1 : role === 'bar' ? 2 : 3} GET / as ${role} → ${target}`, async ({ request }) => {
        const res = await request.get('/', { maxRedirects: 0 })
        expect(res.status()).toBe(307)
        expect(new URL(res.headers()['location'], 'http://x').pathname).toBe(target)
      })
    })
  }
})

test.describe('phone shell · staff', () => {
  test.use({ storageState: as('staff'), viewport: PHONE })

  test('P0-SHELL-04 bottom nav has 5 slots, raised scan is icon-only, no sidebar', async ({ page }) => {
    await page.goto('/tonight')
    const nav = page.locator('nav[aria-label="เมนูหลัก"]:visible')
    await expect(nav).toHaveCount(1)
    await expect(nav.locator(':scope > *')).toHaveCount(5)
    await expect(nav.getByRole('link', { name: 'คืนนี้', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'ฝากเหล้า', exact: true })).toBeVisible()
    const scan = nav.getByRole('link', { name: 'สแกน QR', exact: true })
    await expect(scan).toBeVisible()
    await expect(scan).toHaveText('')
    await expect(nav.getByRole('link', { name: 'จองโต๊ะ', exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'เพิ่มเติม', exact: true })).toBeVisible()
    await noHorizontalScroll(page)
  })

  test('P0-SHELL-07 staff sheet has no reports or settings', async ({ page }) => {
    await page.goto('/tonight')
    await page.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'บัญชีของฉัน', exact: true })).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'รายงาน', exact: true })).toHaveCount(0)
    await expect(sheet.getByRole('link', { name: 'ตั้งค่าการจอง', exact: true })).toHaveCount(0)
  })

  test('P0-SHELL-14 /me has no horizontal scroll at 390px', async ({ page }) => {
    await page.goto('/me')
    await expect(page.getByRole('heading', { name: 'บัญชีของฉัน', exact: true })).toBeVisible()
    await noHorizontalScroll(page)
  })
})

test.describe('phone shell · owner', () => {
  test.use({ storageState: as('owner'), viewport: PHONE })

  test('P0-SHELL-05 owner slot 1 reads ภาพรวม', async ({ page }) => {
    await page.goto('/overview')
    const nav = page.locator('nav[aria-label="เมนูหลัก"]:visible')
    await expect(nav.getByRole('link', { name: 'ภาพรวม', exact: true })).toBeVisible()
  })

  test('P0-SHELL-06 เพิ่มเติม opens a bottom-anchored sheet with owner items', async ({ page }) => {
    await page.goto('/overview')
    await page.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    for (const name of ['รายงาน', 'ตั้งค่าการจอง', 'ผังโต๊ะ', 'รายการเหล้า', 'ผู้ใช้และสาขา']) {
      await expect(sheet.getByRole('link', { name, exact: true })).toBeVisible()
    }
    await expect(sheet.getByRole('button', { name: 'สลับโหมดมืด', exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible()
    const box = await sheet.boundingBox()
    expect(box!.y).toBeGreaterThan(0)
    expect(Math.round(box!.y + box!.height)).toBe(PHONE.height)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })
})

test.describe('desktop shell', () => {
  test.describe('bar', () => {
    test.use({ storageState: as('bar') })
    test('P0-SHELL-08 bar sidebar: daily + account, no owner items, no bottom nav', async ({ page }) => {
      await page.goto('/tonight')
      const side = page.locator('nav[aria-label="เมนูหลัก"]:visible')
      await expect(side).toHaveCount(1)
      await expect(side.getByText('งานประจำวัน', { exact: true })).toBeVisible()
      await expect(side.getByRole('link', { name: 'คืนนี้', exact: true })).toBeVisible()
      await expect(side.getByRole('link', { name: 'รายงาน', exact: true })).toHaveCount(0)
      await expect(side.getByRole('link', { name: 'ผู้ใช้และสาขา', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'เพิ่มเติม', exact: true })).toBeHidden()
    })
    test('P0-SHELL-13 single-branch user has no switcher', async ({ page }) => {
      await page.goto('/tonight')
      await expect(page.getByTestId('branch-switcher')).toHaveCount(0)
      await expect(page.getByText('E2E-A', { exact: true }).first()).toBeVisible()
    })
  })

  test.describe('owner', () => {
    test.use({ storageState: as('owner') })
    test('P0-SHELL-09 owner sidebar shows overview, reports and settings, no tonight', async ({ page }) => {
      await page.goto('/overview')
      const side = page.locator('nav[aria-label="เมนูหลัก"]:visible')
      for (const name of ['ภาพรวมทุกสาขา', 'รายงาน', 'ตั้งค่าการจอง', 'ผังโต๊ะ', 'รายการเหล้า', 'ผู้ใช้และสาขา']) {
        await expect(side.getByRole('link', { name, exact: true })).toBeVisible()
      }
      await expect(side.getByRole('link', { name: 'คืนนี้', exact: true })).toHaveCount(0)
    })
    test('P0-SHELL-12 owner switcher lists every active branch', async ({ page }) => {
      await page.goto('/overview')
      const { count } = await adminDb().from('branches').select('id', { count: 'exact', head: true }).eq('active', true)
      await expect(page.getByTestId('branch-switcher').first().locator('option')).toHaveCount(count!)
    })
  })

  test.describe('multi-branch staff', () => {
    test.use({ storageState: as('multi') })
    test('P0-SHELL-11 switcher lists exactly the 2 assigned branches and persists', async ({ page, context }) => {
      await page.goto('/tonight')
      const sw = page.getByTestId('branch-switcher').first()
      await expect(sw.locator('option')).toHaveText(['E2E-A', 'E2E-B'])
      const { branchB } = fixtureIds()
      await sw.selectOption(branchB)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E-B')
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E-B')
      expect((await context.cookies()).find((c) => c.name === 'sis_branch')?.value).toBe(branchB)
    })
  })

  test.describe('theme + tokens', () => {
    test.use({ storageState: as('staff') })
    test('P0-SHELL-10 P0-UI-02 P0-UI-03 theme toggles, persists, primary button colours', async ({ page }) => {
      await page.goto('/me')
      await page.getByRole('button', { name: 'โหมดสว่าง', exact: true }).click()
      const save = page.getByRole('button', { name: 'บันทึก', exact: true })
      await expect(save).toHaveCSS('background-color', 'rgb(154, 31, 42)')
      await expect(save).toHaveCSS('color', 'rgb(255, 255, 255)')
      await page.getByRole('button', { name: 'โหมดมืด', exact: true }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 16, 17)')
      await expect(save).toHaveCSS('background-color', 'rgb(224, 113, 124)')
      await expect(save).toHaveCSS('color', 'rgb(35, 10, 14)')
      await page.reload()
      await expect(page.locator('html')).toHaveClass(/dark/)
      await page.getByRole('button', { name: 'โหมดสว่าง', exact: true }).click()
      await expect(page.locator('html')).not.toHaveClass(/dark/)
    })
    test('P0-UI-04 body font is IBM Plex Sans Thai', async ({ page }) => {
      await page.goto('/me')
      const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
      expect(family).toMatch(/IBM Plex Sans Thai/)
    })
  })

  test.describe('locale', () => {
    test.use({ storageState: as('multi') })
    test('P0-I18N-03 P0-I18N-02 switching to English stores profiles.locale and renders English nav', async ({ page }) => {
      const { users } = fixtureIds()
      await page.goto('/me')
      await page.getByTestId('locale-en').click()
      const side = page.locator('nav[aria-label="Main menu"]:visible')
      await expect(side.getByRole('link', { name: 'Tonight', exact: true })).toBeVisible()
      await expect(side.getByRole('link', { name: 'Deposits', exact: true })).toBeVisible()
      await expect(side.getByRole('link', { name: 'คืนนี้', exact: true })).toHaveCount(0)
      const { data } = await adminDb().from('profiles').select('locale').eq('id', users.multi).single()
      expect(data?.locale).toBe('en')
      await page.getByRole('button', { name: 'ไทย', exact: true }).click()
      await expect(page.locator('nav[aria-label="เมนูหลัก"]:visible')).toHaveCount(1)
    })
  })
})

test('P0-UI-01 contrast check is green', () => {
  const out = execFileSync(process.execPath, ['scripts/verify-contrast.mjs'], { encoding: 'utf8' })
  expect(out).toMatch(/4 palettes · \d+ pairs checked · 0 below 4\.5:1 · 0 unresolved/)
})

test('P0-I18N-01 catalogs are key-for-key identical', () => {
  const out = execFileSync(process.execPath, ['scripts/verify-catalogs.mjs'], { encoding: 'utf8' })
  expect(out).toMatch(/messages\/staff: 2 locales · \d+ keys · 0 problem/)
  expect(out).toMatch(/messages\/customer: 4 locales · \d+ keys · 0 problem/)
})

test('P0-E2E-01 global setup stored one session per role', () => {
  for (const role of SIGNED_IN_ROLES) {
    const file = as(role)
    expect(existsSync(file)).toBe(true)
    const state = JSON.parse(readFileSync(file, 'utf8')) as { cookies: { name: string }[] }
    expect(state.cookies.some((c) => c.name.startsWith('sb-'))).toBe(true)
  }
})
