import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { AUTH_DIR } from './fixtures/env'
import th from '../../messages/manual/th.json'

/** P4-04 — the user manual (R-037): one page, every role reads the pages of its own role. */
const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const ROLES = ['staff', 'bar', 'owner'] as const
const sections = Object.values(th.sections) as { roles: string[] }[]

for (const role of ROLES) {
  test.describe(role, () => {
    test.use({ storageState: as(role) })

    test(`P4-04-01 P4-04-02 P4-04-03 ${role}: from the menu; concept and roles first; only the ${role}'s pages`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(role === 'owner' ? '/overview' : '/tonight')
      await page.locator('nav[aria-label="เมนูหลัก"]:visible').getByRole('link', { name: 'คู่มือการใช้งาน' }).click()
      await expect(page).toHaveURL(/\/manual$/)
      await expect(page.getByTestId('manual')).toHaveAttribute('data-role', role)
      await expect(page.getByTestId('manual-role')).toContainText(th.roles[role].name)

      const top = (id: string) => page.getByTestId(id).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
      const firstSection = await top('manual-section')
      expect(await top('manual-concept')).toBeLessThan(firstSection)
      expect(await top('manual-roles')).toBeLessThan(firstSection)
      await expect(page.locator('[data-testid="manual-rolecard"].me')).toHaveAttribute('data-role', role)

      const shown = await page.getByTestId('manual-section').evaluateAll((els) => els.map((e) => (e.getAttribute('data-roles') ?? '').split(' ')))
      expect(shown.every((r) => r.includes(role))).toBe(true)
      expect(shown).toHaveLength(sections.filter((s) => s.roles.includes(role)).length)
      if (role !== 'owner') expect(shown.length).toBeLessThan(sections.length)
      const howtos = await page.getByTestId('manual-howto').evaluateAll((els) => els.map((e) => (e.getAttribute('data-roles') ?? '').split(' ')))
      expect(howtos.length).toBeGreaterThan(0)
      expect(howtos.every((r) => r.includes(role))).toBe(true)
    })

    test(`P4-04-01 P4-04-04 ${role}: on a phone — from the เพิ่มเติม sheet, every contents link lands, no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(role === 'owner' ? '/overview' : '/tonight')
      await page.getByRole('button', { name: 'เพิ่มเติม' }).click()
      await page.getByRole('dialog').getByRole('link', { name: 'คู่มือการใช้งาน' }).click()
      await expect(page).toHaveURL(/\/manual$/)
      const hrefs = await page.getByTestId('manual-toc-link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))
      expect(hrefs.length).toBeGreaterThan(0)
      for (const h of hrefs) await expect(page.locator(`[data-testid="manual-section"]${h}`)).toHaveCount(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    })
  })
}

test('P4-04-05 the Thai and English manuals have the same keys', () => {
  const out = execFileSync(process.execPath, ['scripts/verify-catalogs.mjs'], { encoding: 'utf8' })
  expect(out).toMatch(/messages\/manual: 2 locales · \d+ keys · 0 problem\(s\)/)
})
