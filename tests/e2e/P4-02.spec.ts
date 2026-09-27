import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { RUN, cleanupRun, createDeposit } from './fixtures/deposits'

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
test.describe.configure({ mode: 'serial' })

async function waitLive(page: Page) {
  await expect(page.locator('[data-live="joined"]')).toHaveCount(1, { timeout: 20_000 })
}

async function unreadOf(role: 'bar' | 'staff' | 'owner') {
  const userId = fixtureIds().users[role]
  const { count, error } = await adminDb().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null)
  expect(error, error?.message).toBeNull()
  return count ?? 0
}

test.afterAll(async () => {
  await adminDb().from('notifications').delete().like('payload->>customer', `${RUN}%`)
  await cleanupRun()
})

test.describe('staff (branch A)', () => {
  test.use({ storageState: as('staff') })

  test('P4-02-01 a change in the branch refreshes the open list without a reload', async ({ page }) => {
    await page.goto(`/deposits?tab=toConfirm&q=${encodeURIComponent(RUN)}`)
    await waitLive(page)
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))
    const { data, error } = await createDeposit('staff', { qty: 1 })
    expect(error, error?.message).toBeNull()
    await expect(page.getByText(data!.code).first()).toBeVisible({ timeout: 15_000 })
    // still the same document — router.refresh, not a full reload
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
  })

  test('P4-02-02 a change in branch B does not refresh branch A', async ({ page }) => {
    await page.goto('/tonight')
    await waitLive(page)
    let rscRequests = 0
    page.on('request', (r) => {
      if (r.headers()['rsc'] === '1') rscRequests++
    })
    const { error } = await createDeposit('staffB', { qty: 1, branch: 'B' })
    expect(error, error?.message).toBeNull()
    await page.waitForTimeout(4_000)
    expect(rscRequests).toBe(0)
  })

  test('P4-02-06 on a phone the bell opens as a bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tonight')
    // the bell sits in the top bar on phones too
    await page.getByTestId('bell-button').click()
    const sheet = page.getByRole('dialog', { name: 'การแจ้งเตือน' })
    await expect(sheet).toBeVisible()
    const box = await sheet.boundingBox()
    expect(Math.round(box!.y + box!.height)).toBe(844)
    expect(Math.round(box!.width)).toBe(390)
  })
})

test.describe('bar (branch A)', () => {
  test.use({ storageState: as('bar') })

  test('P4-02-03 the bell count is own unread and rises live when bottles wait for confirmation', async ({ page }) => {
    await page.goto('/tonight')
    await waitLive(page)
    const before = await unreadOf('bar')
    if (before > 0) await expect(page.getByTestId('bell-count')).toHaveText(before > 99 ? '99+' : String(before))
    const { error } = await createDeposit('staff', { qty: 1 })
    expect(error, error?.message).toBeNull()
    await expect.poll(() => unreadOf('bar')).toBe(before + 1)
    await expect(page.getByTestId('bell-count')).toHaveText(before + 1 > 99 ? '99+' : String(before + 1), { timeout: 15_000 })
  })

  test('P4-02-04 clicking an item marks it read and follows its link; mark all clears the badge', async ({ page }) => {
    await page.goto('/tonight')
    await waitLive(page)
    await page.getByTestId('bell-button').first().click()
    const first = page.getByTestId('bell-item').first()
    await expect(first).toHaveAttribute('data-unread', 'true')
    // (owner, 2026-09-27) a deposit waiting for bar wears its work's icon box in the "to confirm" hue
    await expect(first).toHaveAttribute('data-kind', 'deposit_received')
    await expect(first.locator('.bg-status-progress-bg svg')).toHaveCount(1)
    const barId = fixtureIds().users.bar
    const { data: newest } = await adminDb().from('notifications').select('id, link').eq('user_id', barId).order('created_at', { ascending: false }).limit(1).single()
    await first.click()
    await expect(page).toHaveURL(new RegExp(`${newest!.link!.replace(/[?]/g, '\\?')}$`))
    await expect.poll(async () => (await adminDb().from('notifications').select('read_at').eq('id', newest!.id).single()).data?.read_at).not.toBeNull()

    await page.getByTestId('bell-button').first().click()
    await page.getByTestId('bell-mark-all').click()
    await expect(page.getByTestId('bell-count')).toHaveCount(0)
    expect(await unreadOf('bar')).toBe(0)
  })

  test('P4-02-05 another user\'s notifications are never visible', async ({ page }) => {
    const ownerId = fixtureIds().users.owner
    const { error: insErr } = await adminDb()
      .from('notifications')
      .insert({ user_id: ownerId, branch_id: fixtureIds().branchA, kind: 'deposit_requested', payload: { customer: `${RUN} owner-only` }, link: '/deposits' })
    expect(insErr, insErr?.message).toBeNull()
    const { data, error } = await dbAs('bar').from('notifications').select('id').eq('user_id', ownerId)
    expect(error, error?.message).toBeNull()
    expect(data).toEqual([])
    await page.goto('/tonight')
    await page.getByTestId('bell-button').first().click()
    await expect(page.getByTestId('bell-list').or(page.getByText('ยังไม่มีการแจ้งเตือน'))).toBeVisible()
    await expect(page.getByText(`${RUN} owner-only`)).toHaveCount(0)
  })
})

test('P4-02-07 a test branch tells only the test accounts — never a real owner (R-051)', async () => {
  const { data: dep, error } = await createDeposit('staff', { qty: 1 }) // received → bar and owner are told
  expect(error, error?.message).toBeNull()
  const admin = adminDb()
  const { data: told, error: toldErr } = await admin.from('notifications').select('user_id').eq('payload->>deposit_id', dep!.id)
  expect(toldErr, toldErr?.message).toBeNull()
  const ids = [...new Set((told ?? []).map((n) => n.user_id))]
  expect(ids).toEqual(expect.arrayContaining([fixtureIds().users.bar, fixtureIds().users.owner]))
  const { data: who, error: whoErr } = await admin.from('profiles').select('username').in('id', ids)
  expect(whoErr, whoErr?.message).toBeNull()
  expect(who!.map((p) => p.username).filter((u) => !u.startsWith('e2e'))).toEqual([])
})
