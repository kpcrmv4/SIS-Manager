import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { RUN, cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { bottleIds, requestWithdrawal } from './fixtures/p2a-flows'
import { addDays, businessNight } from '../../src/lib/date'

/**
 * P4-08 — ประวัติฝาก/เบิก (R-061): the branch's deposit and withdrawal events for every role, by
 * business night, kind, who and a search. Each test narrows to its own deposit code, so the other
 * specs' events on the fixture branch never change what is asserted.
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const tonight = businessNight()

let dep: { id: string; code: string }

test.beforeAll(async () => {
  // received (staff) → confirmed (bar) → withdrawal requested (staff) → completed (bar)
  dep = await mustCreate('staff', { qty: 2 })
  await confirmAll(dep.id, [100, 100])
  const ids = await bottleIds(dep.id)
  const w = await requestWithdrawal(dep.id, [ids[0]], 'take_home', 'staff')
  const { error } = await dbAs('bar').rpc('complete_withdrawals', { p_withdrawal_ids: w.withdrawal_ids })
  expect(error, error?.message).toBeNull()
})

test.afterAll(async () => {
  await cleanupRun()
})

type Feed = { rows: { action: string; code: string; actor_kind: string; actor_role: string | null }[]; total: number; counts: Record<string, number>; summary: { received: number; withdrawn: number; disposed: number } }

async function feed(role: 'staff' | 'bar' | 'owner' | 'staffB', extra: Record<string, unknown> = {}) {
  const { branchA } = fixtureIds()
  return dbAs(role).rpc('deposit_history', {
    p_branch: branchA,
    p_from: `${tonight}T06:00:00+07:00`,
    p_to: `${addDays(tonight, 1)}T06:00:00+07:00`,
    p_q: dep.code,
    ...extra,
  })
}

test('P4-08-01 the feed: this deposit\'s events tonight, who did them, the counts and the totals; another branch is refused', async () => {
  const { data, error } = await feed('staff')
  expect(error, error?.message).toBeNull()
  const f = data as unknown as Feed
  expect(f.rows.map((r) => r.action).sort()).toEqual(['confirmed', 'received', 'withdrawal_completed', 'withdrawal_requested'])
  expect(f.rows.every((r) => r.code === dep.code)).toBe(true)
  expect(f.rows.find((r) => r.action === 'confirmed')).toMatchObject({ actor_kind: 'staff', actor_role: 'bar' })
  expect(f.counts).toEqual({ deposit: 2, withdraw: 2, expiry: 0, other: 0 })
  expect(f.summary).toEqual({ received: 1, withdrawn: 1, disposed: 0 })

  // the same numbers straight from the table
  const { count } = await adminDb().from('deposit_events').select('id', { count: 'exact', head: true }).eq('deposit_id', dep.id)
  expect(f.total).toBe(count)

  expect((await feed('staffB')).error?.message).toBe('FORBIDDEN')
  // a kind narrows the rows, not the counts
  const w = (await feed('bar', { p_group: 'withdraw' })).data as unknown as Feed
  expect(w.rows.map((r) => r.action).sort()).toEqual(['withdrawal_completed', 'withdrawal_requested'])
  expect(w.counts.deposit).toBe(2)
  // last night has none of it
  const { branchA } = fixtureIds()
  const y = (await dbAs('owner').rpc('deposit_history', {
    p_branch: branchA,
    p_from: `${addDays(tonight, -1)}T06:00:00+07:00`,
    p_to: `${tonight}T06:00:00+07:00`,
    p_q: dep.code,
  })).data as unknown as Feed
  expect(y.total).toBe(0)
})

for (const role of ['staff', 'bar', 'owner'] as const) {
  test.describe(`P4-08-02 ${role}`, () => {
    test.use({ storageState: as(role) })

    test(`P4-08-02 ${role} reaches ประวัติฝาก/เบิก from ฝากเหล้า and reads tonight`, async ({ page }) => {
      // the owner works in whichever branch the switcher chose — this one
      if (role === 'owner') await page.context().addCookies([{ name: 'sis_branch', value: fixtureIds().branchA, url: BASE_URL }])
      await page.goto('/deposits')
      await page.getByTestId('deposits-history').click()
      await page.waitForURL(/\/deposits\/history/)
      await expect(page.getByRole('heading', { name: 'ประวัติฝาก/เบิก' })).toBeVisible()
      await expect(page.locator('[data-range="tonight"]')).toHaveAttribute('aria-current', 'true')
      await page.getByTestId('history-q').fill(dep.code)
      await page.getByTestId('history-apply').click()
      const rows = page.getByTestId('history-table').getByTestId('history-row')
      await expect(rows).toHaveCount(4)
      await expect(page.getByTestId('history-table')).toContainText('ยืนยันเหล้า')
      await expect(page.locator('[data-group="withdraw"]').first()).toHaveAttribute('data-count', '2')
    })
  })
}

test.describe('P4-08-03 filters and the phone', () => {
  test.use({ storageState: as('bar'), viewport: { width: 390, height: 844 } })

  test('P4-08-03 kind and who narrow the list; cards on a phone open the deposit', async ({ page }) => {
    await page.goto(`/deposits/history?q=${dep.code}&g=withdraw`)
    const cards = page.getByTestId('history-cards').getByTestId('history-row')
    await expect(cards).toHaveCount(2)
    for (const a of await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-action')))) expect(a).toMatch(/^withdrawal_/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // only what the bar account did
    const { data: me } = await adminDb().from('profiles').select('id').eq('id', fixtureIds().users.bar).single()
    await page.goto(`/deposits/history?q=${dep.code}&actor=${me!.id}`)
    await expect(cards).toHaveCount(2)
    await expect(page.getByTestId('history-cards')).not.toContainText('รับฝาก')

    await cards.first().click()
    await page.waitForURL(new RegExp(`/deposits/${dep.id}$`))
  })
})
