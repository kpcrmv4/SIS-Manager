import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { adminDb, dbAs, fixtureIds, sql } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { BRANCH_A_CODE } from './fixtures/users'
import { RUN, cleanupRun, confirmAll, createDeposit, mustCreate } from './fixtures/deposits'
import { periodRange, previousRange } from '../../src/lib/reports/period'
import { actionItems, delta, pointsDelta, setupItems, tonightHours, type DashBranch, type Trends } from '../../src/lib/reports/dashboard-view'
import { sparkGeometry } from '../../src/lib/reports/spark'

/**
 * P4-01-11 … 21 — the redesigned owner overview (R-030). Every figure is checked against a
 * direct SQL count written here, not against the RPC's own query.
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const BKK_TODAY = `(now() at time zone 'Asia/Bangkok')::date`
const NIGHT = 'private.business_night(now())'
const NIGHT_START = (n: string) => `((${n})::timestamp at time zone 'Asia/Bangkok' + interval '6 hours')`

async function pin(context: BrowserContext, branchId: string) {
  await context.addCookies([{ name: 'sis_branch', value: branchId, url: BASE_URL }])
}

async function trendsRpc(from: string, to: string): Promise<Trends> {
  const prev = previousRange(from, to)
  const { data, error } = await dbAs('owner').rpc('owner_trends', { p_from: from, p_to: to, p_prev_from: prev.from, p_prev_to: prev.to })
  expect(error, error?.message).toBeNull()
  return data as unknown as Trends
}

let expiringCode = ''

test.beforeAll(async () => {
  // branch A: one waiting for the bar (to confirm) and one confirmed that expires tomorrow
  await mustCreate('staff', { qty: 2 })
  const tomorrow = new Date(Date.now() + 26 * 3600 * 1000).toISOString()
  const { data, error } = await createDeposit('bar', { qty: 1, expiresAt: tomorrow })
  expect(error, error?.message).toBeNull()
  await confirmAll(data!.id, [80])
  expiringCode = data!.code
  // a past booking at branch A, same weekday last week (busy-nights chart)
  await sql(`
    insert into public.bookings (branch_id, code, night, slot_time, party_size, name, source, status, arrived_at)
    values ('${fixtureIds().branchA}', 'BK-' || to_char(${NIGHT} - 7, 'MMDD') || '-9' || lpad((floor(random() * 100))::int::text, 2, '0'),
            ${NIGHT} - 7, '21:00', 4, '${RUN} past booking', 'staff', 'arrived', now() - interval '7 days')`)
})

test.afterAll(async () => {
  await adminDb().from('bookings').delete().like('name', `${RUN}%`)
  await cleanupRun()
})

// ── pure decisions ───────────────────────────────────────────────────────

test('P4-01-17 previous comparable period: month-to-date, whole month, clamped month end, 30 days', () => {
  expect(previousRange('2026-09-01', '2026-09-24')).toEqual({ from: '2026-08-01', to: '2026-08-24' })
  expect(previousRange('2026-08-01', '2026-08-31')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  expect(previousRange('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  expect(previousRange('2026-03-01', '2026-03-30')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  expect(previousRange('2026-01-01', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-15' })
  expect(previousRange('2026-08-26', '2026-09-24')).toEqual({ from: '2026-07-27', to: '2026-08-25' })
  expect(delta(12, 10)).toEqual({ dir: 'up', pct: 20 })
  expect(delta(5, 10)).toEqual({ dir: 'down', pct: 50 })
  expect(delta(3, 0)).toEqual({ dir: 'up', pct: null }) // "new"
  expect(delta(0, 0)).toBeNull()
  expect(pointsDelta(80, 75)).toEqual({ dir: 'up', pct: 5 })
  expect(pointsDelta(null, 75)).toBeNull()
  // a gap breaks the line and leaves the area open
  const g = sparkGeometry([1, null, 3, 4])
  expect(g.line.match(/M/g)).toHaveLength(2)
  expect(g.area).toBeNull()
  expect(sparkGeometry([0, 2, 4]).area).not.toBeNull()
})

test('P4-01-11 P4-01-12 P4-01-13 the working branch wins the link; setup names the missing branches; hours run in night order', () => {
  const base: DashBranch = {
    id: 'a', code: 'AAA', name: 'A', to_confirm: 0, requests: 0, withdrawals: 0, bookings_pending: 0, bookings_pending_night: null,
    to_dispose: 0, expiring: 0, in_store_bottles: 0, bookings_tonight: 0, arrived_tonight: 0, printer: 'online', line_oa: true, liff: true,
    staff_group: true, line_failed: 0, has_tables: true, has_items: true, has_staff: true, nights: [],
  }
  const a = { ...base, id: 'a', name: 'A', to_confirm: 1, printer: 'offline' as const }
  const b = { ...base, id: 'b', name: 'B', to_confirm: 5, staff_group: false }
  const items = actionItems([a, b], 'a')
  expect(items.find((i) => i.key === 'to_confirm')).toMatchObject({ count: 6, href: '/deposits?tab=toConfirm' }) // A is working and has some
  expect(actionItems([a, b], null).find((i) => i.key === 'to_confirm')!.href).toBe(`/api/branch/go?b=b&to=${encodeURIComponent('/deposits?tab=toConfirm')}`)
  expect(items.find((i) => i.key === 'printers_offline')).toMatchObject({ count: 1, tone: 'urgent' })
  expect(items.find((i) => i.key === 'requests')).toBeUndefined() // zero → no chip
  // a chip that opens a deposit group wears that group's hue (R-047)
  const busy = Object.fromEntries(actionItems([{ ...base, to_confirm: 1, requests: 1, withdrawals: 1, to_dispose: 1 }], 'a').map((i) => [i.key, i.tone]))
  expect(busy).toMatchObject({ to_confirm: 'progress', requests: 'info', withdrawals: 'violet', to_dispose: 'urgent' })
  const setup = setupItems([a, b], 'a')
  expect(setup.find((s) => s.key === 'staff_group')).toMatchObject({ done: false, missing: ['B'] })
  expect(setup.find((s) => s.key === 'line_oa')).toMatchObject({ done: true, missing: [] })
  expect(setupItems([], null).every((s) => !s.done)).toBe(true)
  // window 19:00–02:00 plus a 05:00 booking → 19 … 23, 0, 1, 2, 5
  const hours = tonightHours({ night: '2026-09-23', open_from: '19:00', open_to: '02:00', bottles_in: 0, bottles_out: 0, hours: [{ hour: 5, bookings: 1, people: 2, arrived: 0, pending: 0, no_show: 0 }] })
  expect(hours.map((h) => h.hour)).toEqual([19, 20, 21, 22, 23, 0, 1, 2, 5])
})

// ── the page, against SQL ────────────────────────────────────────────────

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P4-01-11 ต้องจัดการ chips equal direct SQL; a chip opens its list', async ({ page, context }) => {
    await pin(context, fixtureIds().branchA)
    await expect(async () => {
      const [truth] = await sql<Record<string, number>>(`
        with ab as (select id, expiry_notice_days from public.branches where active)
        select
          (select count(*) from public.deposits d join ab on ab.id = d.branch_id where d.status = 'pending_confirm')::int as to_confirm,
          (select count(*) from public.deposits d join ab on ab.id = d.branch_id where d.status = 'requested')::int as requests,
          (select count(*) from public.withdrawals w join ab on ab.id = w.branch_id where w.status = 'pending')::int as withdrawals,
          (select count(*) from public.bookings k join ab on ab.id = k.branch_id where k.status = 'pending' and k.night >= ${NIGHT})::int as bookings_pending,
          (select count(*) from public.deposits d join ab on ab.id = d.branch_id where d.status in ('in_store', 'pending_withdrawal') and not d.is_vip
             and d.expires_at < ((${BKK_TODAY} + ab.expiry_notice_days + 1)::timestamp at time zone 'Asia/Bangkok'))::int as expiring,
          (select count(*) from public.deposits d join ab on ab.id = d.branch_id where d.status = 'expired')::int as to_dispose,
          (select count(*) from public.print_stations p join ab on ab.id = p.branch_id
             where not (p.is_online and p.last_heartbeat > now() - interval '2 minutes'))::int as printers_offline,
          (select count(*) from public.line_outbox o join ab on ab.id = o.branch_id where o.created_at > now() - interval '7 days'
             and (o.status = 'failed' or (o.status = 'skipped' and o.error like 'HTTP %')))::int as line_failed`)
      await page.goto('/overview')
      for (const [key, n] of Object.entries(truth)) {
        const chip = page.locator(`[data-testid="action-chip"][data-key="${key}"]`)
        if (n > 0) await expect(chip, key).toHaveAttribute('data-count', String(n), { timeout: 1_000 })
        else await expect(chip, key).toHaveCount(0, { timeout: 1_000 })
      }
      expect(truth.to_confirm).toBeGreaterThan(0)
      expect(truth.expiring).toBeGreaterThan(0)
    }).toPass({ timeout: 45_000 })
    await page.locator('[data-testid="action-chip"][data-key="to_confirm"]').click()
    await expect(page).toHaveURL(/\/deposits\?tab=toConfirm$/)
  })

  test('P4-01-12 /settings/branch: the setup card ticks what the working branch has, names the next step, folds the rest', async ({ page, context }) => {
    const { branchA } = fixtureIds()
    await pin(context, branchA)
    const [f] = await sql<Record<string, boolean>>(`
      select
        coalesce(s.channel_access_token is not null and s.channel_secret is not null, false) as line_oa,
        (b.liff_id is not null and b.line_channel_id is not null) as liff,
        (b.staff_group_id is not null) as staff_group,
        exists (select 1 from public.print_stations p where p.branch_id = b.id) as printer,
        exists (select 1 from public.tables t where t.branch_id = b.id and t.active) as tables,
        exists (select 1 from public.liquor_items i where (i.branch_id = b.id or i.branch_id is null) and i.active) as items,
        exists (select 1 from public.user_branches ub join public.profiles p on p.id = ub.user_id and p.active and p.role in ('staff', 'bar') where ub.branch_id = b.id) as staff
      from public.branches b left join public.branch_line_secrets s on s.branch_id = b.id where b.id = '${branchA}'`)
    const keys = ['line_oa', 'liff', 'staff_group', 'printer', 'tables', 'items', 'staff']
    await page.goto('/settings/branch')
    const card = page.getByTestId('setup-card')
    await expect(card).toHaveAttribute('data-done', String(keys.filter((k) => f[k]).length))
    for (const k of keys) await expect(card.locator(`[data-testid="setup-item"][data-key="${k}"]`), k).toHaveAttribute('data-done', String(f[k]))
    const next = keys.find((k) => !f[k])
    if (next) await expect(card.getByTestId('setup-next')).toHaveAttribute('data-key', next)
    else await expect(card.getByTestId('setup-done')).toBeVisible()
    // the full list is folded until asked for
    const first = card.getByTestId('setup-item').first()
    await expect(first).toBeHidden()
    await card.getByTestId('setup-all').click()
    await expect(first).toBeVisible()
    // the overview no longer carries it
    await page.goto('/overview')
    await expect(page.getByTestId('overview-kpis')).toBeVisible()
    await expect(page.getByTestId('setup-card')).toHaveCount(0)
    await expect(page.getByTestId('overview-setup')).toHaveCount(0)
  })

  test('P4-01-13 tonight equals SQL, and another branch\'s deposit moves it without a reload', async ({ page, context }) => {
    await pin(context, fixtureIds().branchA)
    await page.goto('/overview')
    await expect(async () => {
      const [truth] = await sql<{ bookings: number; bottles_in: number }>(`
        select
          (select count(*) from public.bookings k join public.branches b on b.id = k.branch_id and b.active
            where k.night = ${NIGHT} and k.status in ('pending', 'confirmed', 'arrived', 'no_show'))::int as bookings,
          coalesce((select sum(d.quantity) from public.deposits d join public.branches b on b.id = d.branch_id and b.active
            where d.received_at >= ${NIGHT_START(NIGHT)} and d.received_at < ${NIGHT_START(`${NIGHT} + 1`)}), 0)::int as bottles_in`)
      await page.reload()
      await expect(page.getByTestId('tonight-total')).toHaveAttribute('data-bookings', String(truth.bookings), { timeout: 1_000 })
      await expect(page.getByTestId('tonight-bottles')).toHaveAttribute('data-in', String(truth.bottles_in), { timeout: 1_000 })
    }).toPass({ timeout: 45_000 })

    // live: the working branch is A; wait until every other branch's channel is joined, then deposit at B
    const others = page.getByTestId('overview-live-others')
    await expect(async () => {
      const [joined, total] = [await others.getAttribute('data-joined'), await others.getAttribute('data-total')]
      expect(Number(total)).toBeGreaterThan(0)
      expect(joined).toBe(total)
    }).toPass({ timeout: 20_000 })
    const url = page.url()
    const before = Number(await page.getByTestId('tonight-bottles').getAttribute('data-in'))
    await mustCreate('staffB', { qty: 1, branch: 'B' })
    await expect(page.getByTestId('tonight-bottles')).toHaveAttribute('data-in', String(before + 1), { timeout: 20_000 })
    expect(page.url()).toBe(url)
  })

  test('P4-01-14 the activity feed leads with the newest event, names who did it, and opens the deposit', async ({ page, context }) => {
    await pin(context, fixtureIds().branchA)
    const d = await mustCreate('staff', { qty: 1 })
    await page.goto('/overview')
    const items = page.getByTestId('feed-item')
    await expect(items.first()).toBeVisible()
    expect(await items.count()).toBeLessThanOrEqual(12)
    const row = page.locator(`[data-testid="feed-item"][href="/deposits/${d.id}"]`).first()
    await expect(row).toHaveAttribute('data-action', 'received')
    await expect(row).toContainText('E2E staff')
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/deposits/${d.id}$`))
  })

  test('P4-01-15 branches: a card each (≤ 3) or a table (> 3), health and tonight\'s bottles from the DB', async ({ page, context }) => {
    await pin(context, fixtureIds().branchA)
    const rows = await sql<{ code: string; printer: string; grp: boolean }>(`
      select b.code,
        case when p.id is null then 'not_set_up' when p.is_online and p.last_heartbeat > now() - interval '2 minutes' then 'online' else 'offline' end as printer,
        (b.staff_group_id is not null) as grp
      from public.branches b left join public.print_stations p on p.branch_id = b.id where b.active`)
    await page.goto('/overview')
    if (rows.length <= 3) {
      await expect(page.getByTestId('overview-branch-card')).toHaveCount(rows.length)
      await expect(page.getByTestId('overview-branch-row')).toHaveCount(0)
    } else {
      await expect(page.locator('[data-testid="overview-branch-row"]:visible')).toHaveCount(rows.length)
    }
    for (const r of rows) {
      const el = page.locator(`[data-branch="${r.code}"]:visible`).first()
      await expect(el.getByTestId('health-printer'), r.code).toHaveAttribute('data-state', r.printer)
      await expect(el.getByTestId('health-group'), r.code).toHaveAttribute('data-state', r.grp ? 'bound' : 'missing')
    }
    if (rows.length <= 3) {
      const [a] = await sql<{ n: number; night: string }>(`
        select coalesce(sum(d.quantity), 0)::int as n, to_char(${NIGHT}, 'YYYY-MM-DD') as night from public.deposits d
        where d.branch_id = '${fixtureIds().branchA}' and d.received_at >= ${NIGHT_START(NIGHT)} and d.received_at < ${NIGHT_START(`${NIGHT} + 1`)}`)
      const card = page.locator(`[data-testid="overview-branch-card"][data-branch="${BRANCH_A_CODE}"]`)
      await expect(card.locator(`[data-night="${a.night}"]`)).toHaveAttribute('data-in', String(a.n))
    }
  })

  test('P4-01-16 /api/branch/go switches to a visible branch and lands on an allowed path only', async ({ page }) => {
    const { branchB } = fixtureIds()
    const go = (b: string, to: string) => page.request.get(`/api/branch/go?b=${encodeURIComponent(b)}&to=${encodeURIComponent(to)}`, { maxRedirects: 0 })
    const ok = await go(branchB, '/deposits?tab=inStore')
    expect(ok.status()).toBe(303)
    const loc = new URL(ok.headers()['location'], BASE_URL)
    expect(`${loc.pathname}${loc.search}`).toBe('/deposits?tab=inStore')
    expect(ok.headers()['set-cookie']).toContain(`sis_branch=${branchB}`)
    for (const bad of ['//evil.example/deposits', 'https://evil.example/deposits', '/api/reports/export', '/deposits/../api/auth/logout', '/overview', 'deposits']) {
      expect((await go(branchB, bad)).status(), bad).toBe(400)
    }
    expect((await go('00000000-0000-0000-0000-000000000000', '/deposits')).status()).toBe(403)
  })

  test('P4-01-17 previous-period figures equal SQL; the delta chip and last week\'s stock agree', async ({ page }) => {
    const { from, to } = periodRange('month')
    const prev = previousRange(from, to)
    await expect(async () => {
      const trends = await trendsRpc(from, to)
      const [p] = await sql<{ new_deposits: number; disposed: number; withdrawn: number }>(`
        select
          (select count(*) from public.deposits where received_at >= '${prev.from}T00:00:00+07:00' and received_at < ('${prev.to}'::date + 1)::timestamp at time zone 'Asia/Bangkok')::int as new_deposits,
          (select count(*) from public.deposits where status = 'disposed' and disposed_at >= '${prev.from}T00:00:00+07:00' and disposed_at < ('${prev.to}'::date + 1)::timestamp at time zone 'Asia/Bangkok')::int as disposed,
          coalesce((select sum(qty) from public.withdrawals where status = 'completed' and processed_at >= '${prev.from}T00:00:00+07:00' and processed_at < ('${prev.to}'::date + 1)::timestamp at time zone 'Asia/Bangkok'), 0)::int as withdrawn`)
      expect(trends.prev).toMatchObject({ from: prev.from, to: prev.to, new_deposits: p.new_deposits, disposed: p.disposed, bottles_withdrawn: p.withdrawn })
      expect(trends.weeks).toHaveLength(8)
      const { data: ov } = await dbAs('owner').rpc('owner_overview', { p_from: from, p_to: to })
      const k = (ov as { kpi: Record<string, number> }).kpi
      // the stock line is rebuilt from bottles and events — its last point must land on today's stock
      expect(trends.weeks[7].in_store_end).toBe(k.in_store_bottles)

      await page.goto('/overview')
      // a change shows only against a previous period that had something (owner, 2026-09-27)
      const d = trends.prev.new_deposits > 0 ? delta(k.new_deposits, trends.prev.new_deposits) : null
      const chip = page.locator('[data-testid="kpi-delta"][data-kpi="new_deposits"]')
      if (d) await expect(chip).toHaveAttribute('data-dir', d.dir, { timeout: 1_000 })
      else await expect(chip).toHaveCount(0, { timeout: 1_000 })
      // the stock is compared with last week's end — shown only when last week had bottles
      const lastWeek = trends.weeks[6].in_store_end
      const prevWeek = page.getByTestId('kpi-prev-week')
      if (lastWeek > 0) await expect(prevWeek).toHaveAttribute('data-value', String(lastWeek), { timeout: 1_000 })
      else await expect(prevWeek).toHaveCount(0, { timeout: 1_000 })
    }).toPass({ timeout: 45_000 })
  })

  test('P4-01-18 the expiring list is the soonest non-VIP in-store deposits inside each notice window', async ({ page }) => {
    await expect(async () => {
      const soon = await sql<{ code: string; notified: boolean }>(`
        select d.code, d.expiry_notice_sent_at is not null as notified from public.deposits d join public.branches b on b.id = d.branch_id and b.active
        where d.status in ('in_store', 'pending_withdrawal') and not d.is_vip and d.expires_at is not null
          and d.expires_at < ((${BKK_TODAY} + b.expiry_notice_days + 1)::timestamp at time zone 'Asia/Bangkok')
        order by d.expires_at, d.code limit 5`)
      expect(soon.map((s) => s.code)).toContain(expiringCode)
      await page.goto('/overview')
      const items = page.getByTestId('expiring-item')
      await expect(items).toHaveCount(soon.length, { timeout: 1_000 })
      expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-code')))).toEqual(soon.map((s) => s.code))
      expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-notified')))).toEqual(soon.map((s) => String(s.notified)))
    }).toPass({ timeout: 45_000 })
  })

  test('P4-01-19 busy weekdays equal SQL over the 56 nights before tonight', async ({ page }) => {
    const rows = await sql<{ dow: number; n: number }>(`
      select extract(isodow from k.night)::int - 1 as dow, count(*)::int as n
      from public.bookings k join public.branches b on b.id = k.branch_id and b.active
      where k.night >= ${NIGHT} - 56 and k.night < ${NIGHT} and k.status not in ('cancelled', 'rejected')
      group by 1`)
    expect(rows.length).toBeGreaterThan(0) // beforeAll put one last week
    await page.goto('/overview')
    for (let dow = 0; dow < 7; dow++) {
      const n = rows.find((r) => r.dow === dow)?.n ?? 0
      await expect(page.locator(`[data-testid="weekday-cell"][data-dow="${dow}"]`), `dow ${dow}`).toHaveAttribute('data-bookings', String(n))
    }
  })

  test('P4-01-20 top customers and liquor of the period equal SQL', async ({ page }) => {
    const { from, to } = periodRange('month')
    const range = `received_at >= '${from}T00:00:00+07:00' and received_at < ('${to}'::date + 1)::timestamp at time zone 'Asia/Bangkok' and status <> 'cancelled'`
    await expect(async () => {
      const people = await sql<{ q: number }>(`
        select sum(quantity)::int as q from public.deposits where ${range}
        group by coalesce(customer_id::text, nullif(customer_phone, ''), lower(customer_name))
        order by sum(quantity) desc, count(*) desc, max(customer_name) limit 5`)
      const liquor = await sql<{ name: string; q: number }>(`
        select item_name as name, sum(quantity)::int as q from public.deposits where ${range}
        group by item_name order by sum(quantity) desc, count(*) desc, item_name limit 5`)
      await page.goto('/overview')
      const bottles = (id: string) => page.getByTestId(id).getByTestId('top-row').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-bottles'))))
      expect(await bottles('overview-top-customers')).toEqual(people.map((r) => r.q))
      expect(await bottles('overview-top-items')).toEqual(liquor.map((r) => r.q))
      expect(await page.getByTestId('overview-top-items').getByTestId('top-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))).toEqual(liquor.map((r) => r.name))
    }).toPass({ timeout: 45_000 })
  })

  test('P4-01-21 at 390 px: no horizontal scroll, the work comes before the figures, no export here', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/overview')
    await expect(page.getByTestId('overview-kpis')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    const y = async (p: Page, id: string) => (await p.getByTestId(id).boundingBox())!.y
    expect(await y(page, 'overview-actions')).toBeLessThan(await y(page, 'overview-kpis'))
    // (owner, 2026-09-27) the jobs are a list, urgent ones first, and the header adds them up
    const rows = page.getByTestId('action-chip')
    const tones = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')))
    const firstCalm = tones.findIndex((t) => t !== 'urgent')
    if (firstCalm >= 0) expect(tones.slice(firstCalm)).not.toContain('urgent')
    const counts = await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-count'))))
    if (counts.length) await expect(page.getByTestId('actions-summary')).toContainText(`${counts.reduce((n, c) => n + c, 0)} งาน`)
    // (owner, 2026-09-28) no red "เร่งด่วน N" in the header — the urgent rows sit under their own ด่วน heading
    await expect(page.getByTestId('actions-summary')).not.toContainText('ด่วน')
    for (const g of await page.getByTestId('action-group').all()) {
      const group = await g.getAttribute('data-group')
      await expect(g.locator('h3')).toHaveText(group === 'urgent' ? 'ด่วน' : 'รอดำเนินการ')
      const groupTones = await g.getByTestId('action-chip').evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')))
      for (const t of groupTones) expect(group === 'urgent' ? t === 'urgent' : t !== 'urgent').toBe(true)
    }
    // the stock split adds up to the bottles in store; the show-rate split to came + no-show + the rest
    const inStore = Number(await page.locator('[data-testid="kpi-value"][data-kpi="in_store"]').textContent())
    const split = page.getByTestId('stock-split')
    if (await split.count()) {
      const parts = await split.locator('[data-value]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-value'))))
      expect(parts.reduce((n, v) => n + v, 0)).toBe(inStore)
    }
    // no trend lines left
    await expect(page.getByTestId('sparkline')).toHaveCount(0)
    // exports live on /reports (R-034)
    await expect(page.getByTestId('overview-export')).toHaveCount(0)
    await expect(page.getByTestId('overview-export-xlsx')).toHaveCount(0)
  })
})

test.describe('staff', () => {
  test.use({ storageState: as('staff') })
  test('P4-01-16 a branch the staff cannot see is refused; the dashboard RPCs are owner-only', async ({ page }) => {
    const res = await page.request.get(`/api/branch/go?b=${fixtureIds().branchB}&to=${encodeURIComponent('/deposits')}`, { maxRedirects: 0 })
    expect(res.status()).toBe(403)
    for (const role of ['staff', 'bar'] as const) {
      expect((await dbAs(role).rpc('owner_dashboard')).error?.message, role).toContain('FORBIDDEN')
      const { from, to } = periodRange('month')
      const prev = previousRange(from, to)
      expect((await dbAs(role).rpc('owner_trends', { p_from: from, p_to: to, p_prev_from: prev.from, p_prev_to: prev.to })).error?.message, role).toContain('FORBIDDEN')
    }
  })
})
