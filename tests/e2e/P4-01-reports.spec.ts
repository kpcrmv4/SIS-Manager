import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds, sql } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { RUN, bottles, cleanupRun, confirmAll, mustCreate, photo } from './fixtures/deposits'
import { requestWithdrawal } from './fixtures/p2a-flows'
import { addDays, bangkokDate } from '../../src/lib/date'
import { periodRange, previousRange, showRate } from '../../src/lib/reports/period'
import { delta, pointsDelta } from '../../src/lib/reports/dashboard-view'
import { bucketDays, weekdayTotals, type ReportDay } from '../../src/lib/reports/report-view'

/**
 * P4-01-22 … 28 — the redesigned /reports (R-034), scoped to fixture branch A so the shared
 * project's other data never moves the numbers. Every number is checked against SQL written here.
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)

/** `col` inside the Bangkok calendar days from … to (inclusive). */
const within = (col: string, from: string, to: string) =>
  `${col} >= '${from}T00:00:00+07:00' and ${col} < ('${to}'::date + 1)::timestamp at time zone 'Asia/Bangkok'`

/** Which way is good news for each figure — the page's green / red verdict. */
const GOOD = {
  deposits_new: 'up', bottles_new: 'up', withdrawals: 'none', bottles_withdrawn: 'none', expired: 'down', disposed: 'down',
  bookings: 'up', arrived: 'up', no_shows: 'down', cancelled: 'down',
} as const
type Key = keyof typeof GOOD

async function totals(branch: string, from: string, to: string): Promise<Record<Key, number>> {
  const bk = `branch_id = '${branch}' and night between '${from}' and '${to}'`
  const [r] = await sql<Record<Key, number>>(`
    select
      (select count(*) from public.deposits where branch_id = '${branch}' and ${within('received_at', from, to)})::int as deposits_new,
      coalesce((select sum(quantity) from public.deposits where branch_id = '${branch}' and ${within('received_at', from, to)}), 0)::int as bottles_new,
      (select count(*) from public.withdrawals where branch_id = '${branch}' and status = 'completed' and ${within('processed_at', from, to)})::int as withdrawals,
      coalesce((select sum(qty) from public.withdrawals where branch_id = '${branch}' and status = 'completed' and ${within('processed_at', from, to)}), 0)::int as bottles_withdrawn,
      (select count(*) from public.deposits where branch_id = '${branch}' and status in ('expired', 'disposed') and ${within('collect_deadline_at', from, to)})::int as expired,
      (select count(*) from public.deposits where branch_id = '${branch}' and status = 'disposed' and ${within('disposed_at', from, to)})::int as disposed,
      (select count(*) from public.bookings where ${bk} and status not in ('cancelled', 'rejected'))::int as bookings,
      (select count(*) from public.bookings where ${bk} and status = 'arrived')::int as arrived,
      (select count(*) from public.bookings where ${bk} and status = 'no_show')::int as no_shows,
      (select count(*) from public.bookings where ${bk} and status = 'cancelled')::int as cancelled`)
  return r
}

let disposedId = ''

test.beforeAll(async () => {
  // this month at branch A: three confirmed deposits (staff received, bar confirmed), one bottle
  // taken home (bar handed it over), one deposit expired → disposed
  const a = await mustCreate('staff', { qty: 2 })
  await confirmAll(a.id, [100, 70])
  const [first] = await bottles(a.id)
  const wd = await requestWithdrawal(a.id, [first.id], 'take_home', 'staff')
  const { error: wdErr } = await dbAs('bar').rpc('complete_withdrawals', { p_withdrawal_ids: wd.withdrawal_ids })
  expect(wdErr, wdErr?.message).toBeNull()
  const b = await mustCreate('staff', { qty: 1 })
  await confirmAll(b.id, [40])
  const c = await mustCreate('staff', { qty: 1 })
  await confirmAll(c.id, [30])
  const { error: upErr } = await adminDb().from('deposits').update({ status: 'expired', item_name: `${RUN} Disposed` }).eq('id', c.id)
  expect(upErr, upErr?.message).toBeNull()
  const { error: dispErr } = await dbAs('bar').rpc('dispose_deposits', { p_deposit_ids: [c.id], p_reason: 'E2E', p_photo_paths: [await photo()] })
  expect(dispErr, dispErr?.message).toBeNull()
  disposedId = c.id
})

test.afterAll(async () => {
  await cleanupRun()
})

test('P4-01-23 buckets: a bar per day up to 62 days, Monday weeks beyond, sums kept; weekday totals', () => {
  const day = (d: string, n: number): ReportDay => ({ day: d, deposits: n, bottles_in: n * 2, withdrawals: 0, bottles_out: n, disposed: 0, bookings: n, arrived: 0, no_shows: 0, cancelled: 0 })
  const short = Array.from({ length: 30 }, (_, i) => day(addDays('2026-09-01', i), 1))
  expect(bucketDays(short).unit).toBe('day')
  expect(bucketDays(short).buckets).toHaveLength(30)
  const long = Array.from({ length: 90 }, (_, i) => day(addDays('2026-06-03', i), 1)) // starts on a Wednesday
  const w = bucketDays(long)
  expect(w.unit).toBe('week')
  expect(w.buckets[0]).toMatchObject({ from: '2026-06-03', to: '2026-06-07', deposits: 5 }) // Wed → Sun, partial
  expect(w.buckets.slice(1).every((b) => new Date(`${b.from}T00:00:00Z`).getUTCDay() === 1)).toBe(true)
  expect(w.buckets.reduce((n, b) => n + b.bottles_in, 0)).toBe(180)
  expect(weekdayTotals(long).reduce((n, d) => n + d.bookings, 0)).toBe(90)
})

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P4-01-22 every figure equals SQL for the branch and range; the change against the previous period points and colours the way SQL says', async ({ page }) => {
    const { branchA } = fixtureIds()
    const { from, to } = periodRange('month')
    const prev = previousRange(from, to)
    await expect(async () => {
      const [now, before] = await Promise.all([totals(branchA, from, to), totals(branchA, prev.from, prev.to)])
      await page.goto(`/reports?from=${from}&to=${to}&branch=${branchA}`)
      for (const k of Object.keys(GOOD) as Key[]) {
        await expect(page.locator(`[data-testid="report-figure"][data-key="${k}"]`), k).toHaveAttribute('data-value', String(now[k]), { timeout: 1_000 })
        const d = before[k] > 0 ? delta(now[k], before[k]) : null
        const chip = page.locator(`[data-testid="kpi-delta"][data-kpi="${k}"]`)
        if (!d) {
          await expect(chip, k).toHaveCount(0, { timeout: 1_000 })
          continue
        }
        const verdict = GOOD[k] === 'none' || d.dir === 'same' ? 'neutral' : d.dir === GOOD[k] ? 'good' : 'bad'
        await expect(chip, k).toHaveAttribute('data-dir', d.dir, { timeout: 1_000 })
        await expect(chip, k).toHaveAttribute('data-verdict', verdict, { timeout: 1_000 })
      }
      const rate = showRate(now.arrived, now.no_shows)
      await expect(page.locator('[data-testid="report-figure"][data-key="show_rate"]')).toHaveAttribute('data-value', rate === null ? '—' : `${rate}%`, { timeout: 1_000 })
      const rd = pointsDelta(rate, showRate(before.arrived, before.no_shows))
      await expect(page.locator('[data-testid="kpi-delta"][data-kpi="show_rate"]')).toHaveCount(rd ? 1 : 0, { timeout: 1_000 })
      expect(now.deposits_new).toBeGreaterThanOrEqual(3)
      expect(now.bottles_withdrawn).toBeGreaterThanOrEqual(1)
      expect(now.disposed).toBeGreaterThanOrEqual(1)
    }).toPass({ timeout: 45_000 })
  })

  test('P4-01-23 a bar per day of the range; the bars add up to the figures', async ({ page }) => {
    const { branchA } = fixtureIds()
    const { from, to } = periodRange('month')
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
    const sum = (vals: number[]) => String(vals.reduce((a, b) => a + b, 0))
    const figure = (k: string) => page.locator(`[data-testid="report-figure"][data-key="${k}"]`).getAttribute('data-value')
    await page.goto(`/reports?from=${from}&to=${to}&branch=${branchA}`)
    const bars = page.getByTestId('report-bar')
    await expect(bars).toHaveCount(days)
    await expect(bars.first()).toHaveAttribute('data-from', from)
    await expect(bars.last()).toHaveAttribute('data-from', to)
    expect(sum(await bars.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-in')))))).toBe(await figure('bottles_new'))
    expect(sum(await bars.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-out')))))).toBe(await figure('bottles_withdrawn'))
    // the bookings chart shows an empty state (no bars) when the range has no bookings: sum 0
    const nights = page.getByTestId('report-bar-bookings')
    expect(sum(await nights.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-bookings')))))).toBe(await figure('bookings'))
    expect(sum(await nights.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-arrived')))))).toBe(await figure('arrived'))
  })

  test('P4-01-23 on a phone a range wider than the screen scrolls sideways and opens on the newest days', async ({ page }) => {
    const { branchA } = fixtureIds()
    const to = bangkokDate()
    const from = addDays(to, -61) // 62 days: the most that still gets a bar per day
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/reports?from=${from}&to=${to}&branch=${branchA}`)
    const bars = page.getByTestId('report-bar')
    await expect(bars).toHaveCount(62)
    await page.getByTestId('report-chart-flow').scrollIntoViewIfNeeded()
    await expect(bars.last()).toBeInViewport()
    await expect(bars.first()).not.toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  })

  test('P4-01-24 who did the work: each person\'s received + confirmed + handed over + check-ins equals SQL', async ({ page }) => {
    const { branchA } = fixtureIds()
    const { from, to } = periodRange('month')
    await expect(async () => {
      const staff = await sql<{ name: string; total: number }>(`
        select p.display_name as name, count(*)::int as total from (
          select received_by as uid from public.deposits where branch_id = '${branchA}' and received_by is not null and ${within('received_at', from, to)}
          union all select confirmed_by from public.deposits where branch_id = '${branchA}' and confirmed_by is not null and ${within('confirmed_at', from, to)}
          union all select processed_by from public.withdrawals where branch_id = '${branchA}' and status = 'completed' and processed_by is not null and ${within('processed_at', from, to)}
          union all select checked_in_by from public.bookings where branch_id = '${branchA}' and checked_in_by is not null and ${within('arrived_at', from, to)}
        ) w join public.profiles p on p.id = w.uid
        group by p.id, p.display_name order by count(*) desc, p.display_name limit 8`)
      await page.goto(`/reports?from=${from}&to=${to}&branch=${branchA}`)
      const rows = await page.getByTestId('report-staff-row').evaluateAll((els) => els.map((e) => [e.getAttribute('data-name'), Number(e.getAttribute('data-total'))]))
      expect(rows).toEqual(staff.map((s) => [s.name, s.total]))
      expect(staff.map((s) => s.name)).toEqual(expect.arrayContaining(['E2E staff', 'E2E bar']))
    }).toPass({ timeout: 45_000 })
  })

  test('P4-01-25 top liquor and top customers of the range (cancelled excluded) equal SQL', async ({ page }) => {
    const { branchA } = fixtureIds()
    const { from, to } = periodRange('month')
    const base = `from public.deposits where branch_id = '${branchA}' and status <> 'cancelled' and ${within('received_at', from, to)}`
    await expect(async () => {
      const items = await sql<{ name: string; q: number }>(`
        select item_name as name, sum(quantity)::int as q ${base}
        group by item_name order by sum(quantity) desc, count(*) desc, item_name limit 5`)
      const people = await sql<{ name: string; q: number }>(`
        select max(customer_name) as name, sum(quantity)::int as q ${base}
        group by coalesce(customer_id::text, nullif(customer_phone, ''), lower(customer_name))
        order by sum(quantity) desc, count(*) desc, max(customer_name) limit 5`)
      await page.goto(`/reports?from=${from}&to=${to}&branch=${branchA}`)
      const read = (id: string) => page.getByTestId(id).getByTestId('top-row').evaluateAll((els) => els.map((e) => [e.getAttribute('data-name'), Number(e.getAttribute('data-bottles'))]))
      expect(await read('report-top-items')).toEqual(items.map((r) => [r.name, r.q]))
      expect(await read('report-top-customers')).toEqual(people.map((r) => [r.name, r.q]))
      expect(items.map((r) => r.name)).toContain(`${RUN} Disposed`)
    }).toPass({ timeout: 45_000 })
  })

  test('P4-01-26 the disposals of the range, newest first, each linking to its deposit, equal SQL', async ({ page }) => {
    const { branchA } = fixtureIds()
    const { from, to } = periodRange('month')
    await expect(async () => {
      const gone = await sql<{ id: string }>(`
        select id from public.deposits where branch_id = '${branchA}' and status = 'disposed' and ${within('disposed_at', from, to)}
        order by disposed_at desc limit 20`)
      await page.goto(`/reports?from=${from}&to=${to}&branch=${branchA}`)
      const hrefs = await page.getByTestId('report-disposals').locator('a').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))
      expect(hrefs).toHaveLength(gone.length)
      gone.forEach((g, i) => expect(hrefs[i]).toContain(g.id))
      expect(gone.map((g) => g.id)).toContain(disposedId)
    }).toPass({ timeout: 45_000 })
  })

  test('P4-01-27 quick ranges keep the branch; the export menu carries the range; over a year shows a message and no export', async ({ page }) => {
    const { branchA } = fixtureIds()
    const today = bangkokDate()
    await page.goto(`/reports?branch=${branchA}`)
    await expect(page.getByTestId('reports-ranges').locator('[data-range="month"]')).toHaveAttribute('aria-current', 'true')
    await page.getByTestId('reports-ranges').locator('[data-range="90"]').click()
    await expect(page).toHaveURL(new RegExp(`from=${addDays(today, -89)}&to=${today}&branch=${branchA}`))
    await expect(page.getByTestId('reports-ranges').locator('[data-range="90"]')).toHaveAttribute('aria-current', 'true')
    // 90 days > 62: a bar per Monday week, the first one partial from the range's first day
    await expect(page.getByTestId('report-chart-flow').locator('ol')).toHaveAttribute('data-unit', 'week')
    await expect(page.getByTestId('report-bar').first()).toHaveAttribute('data-from', addDays(today, -89))

    await page.getByTestId('reports-export').locator('summary').click()
    const xlsx = page.getByTestId('reports-export-xlsx')
    await expect(xlsx).toBeVisible()
    const href = (await xlsx.getAttribute('href'))!
    expect(href).toContain(`from=${addDays(today, -89)}`)
    expect(href).toContain(`to=${today}`)
    expect(href).toContain(`branch=${branchA}`)
    expect((await page.request.get(href)).status()).toBe(200)

    await page.goto('/reports?from=2024-01-01&to=2025-06-30')
    await expect(page.getByText('เลือกช่วงได้ไม่เกิน 1 ปี')).toBeVisible()
    await expect(page.getByTestId('reports-export')).toHaveCount(0)
    await expect(page.getByTestId('report-figures-deposits')).toHaveCount(0)
  })
})

test('P4-01-28 owner_report_detail: owner only, one row per day, a range over a year refused', async () => {
  const { branchA } = fixtureIds()
  const { from, to } = periodRange('month')
  for (const role of ['staff', 'bar'] as const) {
    expect((await dbAs(role).rpc('owner_report_detail', { p_from: from, p_to: to })).error?.message, role).toContain('FORBIDDEN')
  }
  const { data, error } = await dbAs('owner').rpc('owner_report_detail', { p_from: from, p_to: to, p_branch: branchA })
  expect(error, error?.message).toBeNull()
  const days = (data as unknown as { days: ReportDay[] }).days
  expect(days.map((d) => d.day)).toEqual(Array.from({ length: days.length }, (_, i) => addDays(from, i)))
  expect(days.at(-1)?.day).toBe(to)
  const tooLong = await dbAs('owner').rpc('owner_report_detail', { p_from: '2024-01-01', p_to: '2025-06-30' })
  expect(tooLong.error?.message).toContain('BAD_RANGE')
})
