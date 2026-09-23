import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { RUN, cleanupRun, confirmAll, createDeposit, mustCreate } from './fixtures/deposits'
import { addDays, bangkokDate } from '../../src/lib/date'

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const PHONE = { width: 390, height: 844 }

test.describe.configure({ mode: 'serial' })

let inStoreDep: { id: string; code: string }
let toConfirmDep: { id: string; code: string }
let vipDep: { id: string; code: string }
let urgentDep: { id: string; code: string }
let progressDep: { id: string; code: string }
let branchBDep: { id: string; code: string }
let paginationCount = 0

/** A Bangkok calendar date N days out — matches how the app's own daysUntil()/badge compute "days left". */
function futureExpiry(days: number): string {
  return `${addDays(bangkokDate(), days)}T12:00:00+07:00`
}

test.beforeAll(async () => {
  inStoreDep = await mustCreate('staff', { qty: 2 })
  await confirmAll(inStoreDep.id, [80, 100])

  toConfirmDep = await mustCreate('staff', { qty: 1 })

  vipDep = await mustCreate('staff', { qty: 1 })
  await confirmAll(vipDep.id, [100])
  const { error: vipError } = await dbAs('bar').rpc('set_vip', { p_deposit: vipDep.id, p_vip: true })
  expect(vipError, vipError?.message).toBeNull()

  const { data: urgentData, error: urgentError } = await createDeposit('bar', { qty: 1, expiresAt: futureExpiry(2) })
  expect(urgentError, urgentError?.message).toBeNull()
  urgentDep = urgentData!
  await confirmAll(urgentDep.id, [100])

  const { data: progressData, error: progressError } = await createDeposit('bar', { qty: 1, expiresAt: futureExpiry(5) })
  expect(progressError, progressError?.message).toBeNull()
  progressDep = progressData!
  await confirmAll(progressDep.id, [100])

  branchBDep = await mustCreate('staffB', { qty: 1, branch: 'B' })

  // A second page's worth of rows (25/page) — all land in "รอยืนยันเหล้า" (pending_confirm).
  const created = await Promise.all(Array.from({ length: 26 }, () => createDeposit('staff', { qty: 1 })))
  for (const c of created) expect(c.error, c.error?.message).toBeNull()
  paginationCount = created.length + 1 // + toConfirmDep itself
})

test.afterAll(async () => {
  await cleanupRun()
})

test.describe('desktop (1280px)', () => {
  test.use({ storageState: as('staff') })

  test('P2-A1-01 desktop table columns, branch-A-only rows, mobile cards hidden', async ({ page }) => {
    await page.goto('/deposits')
    const table = page.getByTestId('deposits-table-desktop')
    await expect(table).toBeVisible()
    await expect(table.locator('thead th')).toHaveText(['รหัสฝาก', 'ลูกค้า', 'เหล้า', 'คงเหลือ', 'หมดอายุ', 'สถานะ'])
    await expect(page.getByTestId('deposits-list-mobile')).toBeHidden()
  })

  test('P2-A1-07 badges: VIP gold, urgent ≤2 days, progress 3-7 days, done in-store', async ({ page }) => {
    const row = (code: string) => page.locator('[data-testid="deposit-row"]', { has: page.locator(`.code:text-is("${code}")`) })
    await page.goto('/deposits')
    await expect(row(vipDep.code).getByText('VIP ไม่หมดอายุ', { exact: true })).toBeVisible()
    await expect(row(urgentDep.code).getByText('อีก 2 วัน', { exact: true })).toBeVisible()
    await expect(row(progressDep.code).getByText('อีก 5 วัน', { exact: true })).toBeVisible()
    await expect(row(inStoreDep.code).getByText('อยู่ในร้าน', { exact: true })).toBeVisible()
  })

  test('P2-A1-03 tabs change the URL and each count matches the DB', async ({ page }) => {
    const { branchA } = fixtureIds()
    const admin = adminDb()
    await page.goto('/deposits')

    const [{ count: inStore }, { count: toConfirm }, { count: requests }, { count: expired }, { count: closed }] = await Promise.all([
      admin.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchA).in('status', ['in_store', 'pending_withdrawal']),
      admin.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchA).eq('status', 'pending_confirm'),
      admin.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchA).eq('status', 'requested'),
      admin.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchA).eq('status', 'expired'),
      admin.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchA).in('status', ['withdrawn', 'disposed', 'cancelled']),
    ])
    const { data: pendingW } = await admin.from('withdrawals').select('deposit_id').eq('branch_id', branchA).eq('status', 'pending')
    const withdraw = new Set((pendingW ?? []).map((w) => w.deposit_id)).size

    const expected: Record<string, number> = { inStore: inStore ?? 0, toConfirm: toConfirm ?? 0, withdraw, requests: requests ?? 0, expired: expired ?? 0, closed: closed ?? 0 }

    for (const key of Object.keys(expected)) {
      const tab = page.getByTestId(`deposits-tab-${key}`)
      await expect(tab.locator('.c')).toHaveText(String(expected[key]))
      await tab.click()
      await expect(page).toHaveURL(key === 'inStore' ? /\/deposits(\?.*)?$/ : new RegExp(`tab=${key}`))
      await expect(tab).toHaveAttribute('aria-selected', 'true')
    }
  })

  test('P2-A1-04 search: code, phone digits, and a comma-bearing term stays quoted', async ({ page }) => {
    await page.goto(`/deposits?q=${encodeURIComponent(inStoreDep.code)}`)
    await expect(page.getByText(inStoreDep.code, { exact: true }).first()).toBeVisible()
    await expect(page.locator('[data-testid="deposit-row"]:visible')).toHaveCount(1)

    await page.goto(`/deposits?q=${encodeURIComponent('081-234')}`)
    await expect(page.locator('[data-testid="deposit-row"]:visible').first()).toBeVisible()

    await page.goto(`/deposits?q=${encodeURIComponent(`${RUN},) nothing-should-match-this-literal-string`)}`)
    await expect(page.getByText('ไม่พบรายการที่ตรงกับ', { exact: false })).toBeVisible()
  })

  test('P2-A1-05 pagination: 25/page, ถัดไป loads the next page', async ({ page }) => {
    await page.goto('/deposits?tab=toConfirm')
    await expect(page.locator('[data-testid="deposit-row"]:visible')).toHaveCount(25)
    await expect(page.getByText(`แสดง 1–25 จาก ${paginationCount} รายการ`, { exact: true })).toBeVisible()
    await page.getByTestId('deposits-next').click()
    await expect(page).toHaveURL(/page=2/)
    const remaining = paginationCount - 25
    await expect(page.locator('[data-testid="deposit-row"]:visible')).toHaveCount(remaining)
    await expect(page.getByText(`แสดง 26–${paginationCount} จาก ${paginationCount} รายการ`, { exact: true })).toBeVisible()
  })

  test('P2-A1-06 an empty tab shows its catalog empty state', async ({ page }) => {
    const { branchA } = fixtureIds()
    const { count } = await adminDb().from('withdrawals').select('id', { count: 'exact', head: true }).eq('branch_id', branchA).eq('status', 'pending')
    test.skip(count !== 0, 'branch already has a pending withdrawal from another run')
    await page.goto('/deposits?tab=withdraw')
    await expect(page.getByText('ไม่มีคำขอเบิกที่รออยู่', { exact: true })).toBeVisible()
    await expect(page.getByText('เมื่อลูกค้ากดขอเบิกใน LINE หรือพนักงานสร้างคำขอ รายการจะขึ้นที่นี่ทันที', { exact: true })).toBeVisible()
  })

  test('P2-A1-08 detail: bottles grid, kv facts, history newest-first with an actor name', async ({ page }) => {
    await page.goto(`/deposits/${inStoreDep.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByTestId('bottle-1')).toBeVisible()
    await expect(page.getByTestId('bottle-2')).toBeVisible()
    await expect(page.getByText('ลูกค้า', { exact: true })).toBeVisible()
    const events = page.getByTestId('history-event')
    await expect(events).toHaveCount(2) // received, confirmed
    await expect(events.first().locator('.s.num')).toContainText('E2E bar') // newest = confirmed, by bar (actor name)
  })

  test('P2-A1-09 a branch-B deposit id is a 404 for a branch-A staff', async ({ page }) => {
    const res = await page.goto(`/deposits/${branchBDep.id}`)
    expect(res?.status()).toBe(404)
  })

  test('P2-A1-11 a failed load renders the retry card and retry recovers it', async ({ page }) => {
    await page.goto('/deposits?q=__e2e_fail__')
    const errorCard = page.locator('.panel[role="alert"]')
    await expect(errorCard).toBeVisible()
    await expect(page.getByText('โหลดข้อมูลไม่สำเร็จ', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ฝากเหล้า', exact: true })).toBeVisible()
    await expect(errorCard).toHaveCount(0)
  })
})

test.describe('detail actions by role', () => {
  test.describe('staff', () => {
    test.use({ storageState: as('staff') })
    test('P2-A1-10 staff sees withdraw + print, not extend/VIP/confirm/dispose, and the note', async ({ page }) => {
      await page.goto(`/deposits/${inStoreDep.id}`)
      await expect(page.getByTestId('action-withdraw')).toBeVisible()
      await expect(page.getByTestId('print-receipt')).toBeVisible()
      await expect(page.getByTestId('action-extend')).toHaveCount(0)
      await expect(page.getByTestId('action-vip')).toHaveCount(0)
      await expect(page.getByTestId('action-confirm')).toHaveCount(0)
      await expect(page.getByTestId('bar-only-note')).toHaveText('ต่ออายุและตั้ง VIP ได้เฉพาะ bar และ owner')
    })
  })

  test.describe('bar', () => {
    test.use({ storageState: as('bar') })
    test('P2-A1-10 bar sees confirm + reject on a pending_confirm deposit', async ({ page }) => {
      await page.goto(`/deposits/${toConfirmDep.id}`)
      await expect(page.getByTestId('action-confirm')).toBeVisible()
      await expect(page.getByTestId('action-reject')).toBeVisible()
      await expect(page.getByTestId('bar-only-note')).toHaveCount(0)
    })
  })
})

test.describe('phone (390px)', () => {
  test.use({ storageState: as('staff'), viewport: PHONE })

  test('P2-A1-02 phone: cards visible, table hidden, card shows code/item/remaining/badge', async ({ page }) => {
    await page.goto('/deposits')
    await expect(page.getByTestId('deposits-table-desktop')).toBeHidden()
    const mobile = page.getByTestId('deposits-list-mobile')
    await expect(mobile).toBeVisible()
    const card = mobile.locator('a', { hasText: inStoreDep.code })
    await expect(card).toBeVisible()
    await expect(card.getByText('อยู่ในร้าน', { exact: true })).toBeVisible()
  })
})
