import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { MockLine, configureBranches } from './fixtures/p3a-line'

// R-080: the owner's sign-in link + QR, and the branch's LINE add-friend QR for every role
test.describe.configure({ mode: 'serial' })
const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const line = new MockLine()

test.beforeAll(async () => {
  await line.start()
  await configureBranches()
})
test.afterAll(async () => {
  await line.stop()
  const { branchA, branchB } = fixtureIds()
  await adminDb().from('branch_line_secrets').delete().in('branch_id', [branchA, branchB])
})

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P4-14-01 ผู้ใช้และสาขา shows the sign-in link with a QR, copy and download', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL })
    await page.goto('/settings/users')
    const card = page.getByTestId('login-link')
    await expect(card).toBeVisible()
    const url = await card.getAttribute('data-url')
    expect(url).toMatch(/^https?:\/\/.+\/login$/)
    await expect(page.getByTestId('login-link-url')).toHaveText(url!)
    await expect(page.getByTestId('login-link-qr')).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect(page.getByTestId('login-link-download')).toHaveAttribute('download', 'sis-manager-login-qr.png')
    await page.getByTestId('login-link-copy').click()
    await expect(page.getByText('คัดลอกลิงก์แล้ว')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url)
  })
})

test.describe('staff', () => {
  test.use({ storageState: as('staff') })

  test('P4-14-02 QR เพิ่มเพื่อน LINE shows the branch OA add-friend QR from LINE bot info', async ({ page }) => {
    await page.goto('/line-qr')
    const box = page.getByTestId('line-qr')
    await expect(box).toBeVisible()
    await expect(box).toHaveAttribute('data-url', 'https://line.me/R/ti/p/%40e2eshop')
    await expect(box).toContainText('@e2eshop')
    await expect(page.getByTestId('line-qr-image')).toHaveAttribute('src', /^data:image\/png;base64,/)
    expect(line.requests.some((r) => r.path === '/v2/bot/info')).toBe(true)
  })
})

test.describe('staff B', () => {
  test.use({ storageState: as('staffB') })

  test('P4-14-03 a branch without a channel token says so instead of a QR', async ({ page }) => {
    await page.goto('/line-qr')
    await expect(page.getByTestId('line-qr-missing')).toContainText('สาขานี้ยังไม่ได้เชื่อม LINE OA')
    await expect(page.getByTestId('line-qr')).toHaveCount(0)
  })
})
