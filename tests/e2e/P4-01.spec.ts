import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { expect, test, request as pwRequest } from '@playwright/test'
import { adminDb, dbAs, fixtureIds, sql } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { BRANCH_A_CODE } from './fixtures/users'
import { RUN, cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { bangkokDate } from '../../src/lib/date'
import { periodRange } from '../../src/lib/reports/period'

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
test.describe.configure({ mode: 'serial' })

const BULK = `${RUN}-BULK`
const BULK_FROM = '2020-01-01'
const BULK_TO = '2020-01-31'
const BULK_ROWS = 1050
const BULK_ON = process.env.E2E_BULK === '1'
let branchA = ''
let disposedItem = ''

type Overview = {
  kpi: Record<string, number>
  branches: { code: string; in_store_bottles: number; to_confirm: number; expiring: number; to_dispose: number; bookings_tonight: number; arrived_tonight: number }[]
  recent_disposals: { id: string; item: string; notified: boolean }[]
}

async function ownerOverview(from: string, to: string): Promise<Overview> {
  const { data, error } = await dbAs('owner').rpc('owner_overview', { p_from: from, p_to: to })
  expect(error, error?.message).toBeNull()
  return data as unknown as Overview
}

/** Direct SQL for one branch — the independent oracle the RPC is checked against. */
async function branchTruth(branchId: string) {
  const [r] = await sql<Record<string, number>>(`
    select
      coalesce((select sum(remaining_qty) from public.deposits where branch_id = '${branchId}' and status in ('in_store','pending_withdrawal')), 0)::int as in_store_bottles,
      (select count(*) from public.deposits where branch_id = '${branchId}' and status = 'pending_confirm')::int as to_confirm,
      (select count(*) from public.deposits where branch_id = '${branchId}' and status = 'expired')::int as to_dispose`)
  return r
}

test.beforeAll(async () => {
  branchA = fixtureIds().branchA
  // two confirmed deposits (3 bottles in store), one waiting for bar confirmation
  const d1 = await mustCreate('staff', { qty: 2 })
  await confirmAll(d1.id, [100, 100])
  const d2 = await mustCreate('staff', { qty: 1 })
  await confirmAll(d2.id, [60])
  await mustCreate('staff', { qty: 1 })
  // one expired → disposed (the recent-disposals row)
  const d3 = await mustCreate('staff', { qty: 1 })
  await confirmAll(d3.id, [30])
  disposedItem = `${RUN} Disposed`
  const { error: upErr } = await adminDb().from('deposits').update({ status: 'expired', item_name: disposedItem }).eq('id', d3.id)
  expect(upErr, upErr?.message).toBeNull()
  const { error: dispErr } = await dbAs('bar').rpc('dispose_deposits', { p_deposit_ids: [d3.id], p_reason: 'E2E' })
  expect(dispErr, dispErr?.message).toBeNull()

  // > 1,000 rows in a closed 2020 range, to prove the Excel export pages past PostgREST's cap.
  // Opt-in only (E2E_BULK=1): proven once on 2026-09-24 (1,050 rows exported), recorded in
  // docs/test-plan/P4.md — owner asked not to repeat it on every run (disk IO on the project).
  // (one SQL statement: the link_code column default is not executable by the service role)
  if (!BULK_ON) return
  await sql(`
    insert into public.deposits (branch_id, code, customer_name, item_name, quantity, status, received_at)
    select '${branchA}', 'DEP-${BRANCH_A_CODE}-X' || lpad(g::text, 4, '0'), '${BULK} ' || g, 'Bulk', 1, 'withdrawn', '2020-01-15T12:00:00+07:00'
    from generate_series(1, ${BULK_ROWS}) g`)
  const [{ n }] = await sql<{ n: number }>(`select count(*)::int as n from public.deposits where branch_id = '${branchA}' and customer_name like '${BULK}%'`)
  expect(n).toBe(BULK_ROWS)
})

test.afterAll(async () => {
  if (BULK_ON) await adminDb().from('deposits').delete().eq('branch_id', branchA).like('customer_name', `${BULK}%`)
  await cleanupRun()
})

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P4-01-01 P4-01-03 overview KPIs match the RPC; the fixture branch row matches direct SQL', async ({ page }) => {
    const { from, to } = periodRange('month')
    const truth = await branchTruth(branchA)
    const rpc = await ownerOverview(from, to)
    const mine = rpc.branches.find((b) => b.code === BRANCH_A_CODE)!
    expect(mine).toMatchObject({ in_store_bottles: truth.in_store_bottles, to_confirm: truth.to_confirm, to_dispose: truth.to_dispose })
    expect(mine.in_store_bottles).toBeGreaterThanOrEqual(3)
    expect(mine.to_confirm).toBeGreaterThanOrEqual(1)

    // new deposits this month: RPC = direct count (other workers may write concurrently → retry)
    await expect(async () => {
      const [c] = await sql<{ n: number }>(
        `select count(*)::int as n from public.deposits where received_at >= '${from}T00:00:00+07:00' and received_at < ('${to}'::date + 1)::timestamp at time zone 'Asia/Bangkok'`,
      )
      const again = await ownerOverview(from, to)
      expect(again.kpi.new_deposits).toBe(c.n)
    }).toPass({ timeout: 20_000 })

    await page.goto('/overview')
    const row = page.getByTestId('overview-branch-row').and(page.locator(`[data-branch="${BRANCH_A_CODE}"]`))
    await expect(row).toBeVisible()
    await expect(row.locator('td').nth(1)).toHaveText(String(truth.in_store_bottles))
    await expect(row.locator('td').nth(2)).toHaveText(String(truth.to_confirm))

    // the four KPI cells show what the RPC returns at render time
    await expect(async () => {
      await page.reload()
      const k = (await ownerOverview(from, to)).kpi
      const metrics = page.locator('main .tnum.text-3xl')
      await expect(metrics.nth(0)).toHaveText(String(k.in_store_bottles))
      await expect(metrics.nth(1)).toHaveText(String(k.new_deposits))
      await expect(metrics.nth(2)).toHaveText(String(k.disposed))
    }).toPass({ timeout: 30_000 })
  })

  test('P4-01-01b on a phone each branch card has a liquor row above a bookings row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/overview')
    const card = page.getByTestId('overview-branch-card').and(page.locator(`[data-branch="${BRANCH_A_CODE}"]`))
    await expect(card).toBeVisible()
    const liquor = await card.getByTestId('overview-card-liquor').boundingBox()
    const bookings = await card.getByTestId('overview-card-bookings').boundingBox()
    expect(bookings!.y).toBeGreaterThanOrEqual(liquor!.y + liquor!.height - 1)
    await expect(card.getByTestId('overview-card-liquor')).toContainText('ขวดในร้าน')
    await expect(card.getByTestId('overview-card-bookings')).toContainText('จองคืนนี้')
  })

  test('P4-01-02 period chips switch the Bangkok range', async ({ page }) => {
    const last = periodRange('last')
    const today = bangkokDate()
    expect(last.to < `${today.slice(0, 7)}-01`).toBe(true)
    expect(last.from.endsWith('-01')).toBe(true)
    const r30 = periodRange('30')
    expect(r30.to).toBe(today)

    await page.goto('/overview')
    await page.getByRole('link', { name: 'เดือนที่แล้ว' }).click()
    await expect(page).toHaveURL(/period=last/)
    await expect(async () => {
      const k = (await ownerOverview(last.from, last.to)).kpi
      await expect(page.locator('main .tnum.text-3xl').nth(1)).toHaveText(String(k.new_deposits))
    }).toPass({ timeout: 20_000 })
  })

  test('P4-01-04 recent disposals list the disposed deposit, without "LINE notified" for an unlinked customer', async ({ page }) => {
    const rpc = await ownerOverview(...(Object.values(periodRange('month')) as [string, string]))
    const hit = rpc.recent_disposals.find((d) => d.item === disposedItem)
    expect(hit, 'disposed deposit in recent_disposals').toBeTruthy()
    expect(hit!.notified).toBe(false)
    await page.goto('/overview')
    const item = page.getByTestId('overview-disposals').getByText(disposedItem, { exact: false })
    await expect(item).toBeVisible()
    await expect(item.locator('xpath=ancestor::a[1]')).not.toContainText('แจ้ง LINE แล้ว')
  })

  test('P4-01-06 reports: fixture branch row equals SQL for the range', async ({ page }) => {
    const { from, to } = periodRange('month')
    const [truth] = await sql<Record<string, number>>(`
      select
        (select count(*) from public.deposits where branch_id = '${branchA}' and received_at >= '${from}T00:00:00+07:00' and received_at < ('${to}'::date + 1)::timestamp at time zone 'Asia/Bangkok')::int as deposits_new,
        (select count(*) from public.deposits where branch_id = '${branchA}' and status = 'disposed' and disposed_at >= '${from}T00:00:00+07:00' and disposed_at < ('${to}'::date + 1)::timestamp at time zone 'Asia/Bangkok')::int as disposed`)
    await page.goto(`/reports?from=${from}&to=${to}&branch=${branchA}`)
    const row = page.getByTestId('reports-row').and(page.locator(`[data-branch="${BRANCH_A_CODE}"]`))
    await expect(row.locator('[data-col="deposits_new"]')).toHaveText(String(truth.deposits_new))
    await expect(row.locator('[data-col="disposed"]')).toHaveText(String(truth.disposed))
    await expect(page.getByTestId('reports-row')).toHaveCount(1) // branch filter applied
  })

  test('P4-01-07 Excel export: four sheets, deposit rows equal the DB for the range', async ({ page }) => {
    const { from, to } = periodRange('month')
    const [{ n }] = await sql<{ n: number }>(
      `select count(*)::int as n from public.deposits where branch_id = '${branchA}' and received_at >= '${from}T00:00:00+07:00' and received_at < ('${to}'::date + 1)::timestamp at time zone 'Asia/Bangkok'`,
    )
    const res = await page.request.get(`/api/reports/export?format=xlsx&from=${from}&to=${to}&branch=${branchA}`)
    expect(res.status()).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['สรุป', 'ฝาก', 'เบิก', 'จอง'])
    expect(wb.getWorksheet('ฝาก')!.rowCount - 1).toBe(n)
  })

  test('P4-01-07 [bulk, opt-in E2E_BULK=1] Excel export pages past 1,000 rows', async ({ page }) => {
    test.skip(!BULK_ON, 'proven 2026-09-24 (1,050 rows); opt-in to spare project disk IO')
    const res = await page.request.get(`/api/reports/export?format=xlsx&from=${BULK_FROM}&to=${BULK_TO}&branch=${branchA}`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('spreadsheetml')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['สรุป', 'ฝาก', 'เบิก', 'จอง'])
    expect(wb.getWorksheet('ฝาก')!.rowCount - 1).toBe(BULK_ROWS)
    const summary = wb.getWorksheet('สรุป')!
    expect(summary.getRow(2).getCell(2).value).toBe(BULK_ROWS) // deposits_new for the fixture branch
  })

  test('P4-01-08 PDF export embeds a Thai font', async ({ page }) => {
    const { from, to } = periodRange('month')
    const res = await page.request.get(`/api/reports/export?format=pdf&from=${from}&to=${to}`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('application/pdf')
    const body = await res.body()
    expect(body.subarray(0, 5).toString()).toBe('%PDF-')
    expect(body.includes(Buffer.from('Sarabun'))).toBe(true)
  })

  test('P4-01-10 an empty range still renders zeros and valid exports', async ({ page }) => {
    await page.goto(`/reports?from=2001-01-01&to=2001-01-02&branch=${branchA}`)
    await expect(page.getByTestId('reports-row').locator('[data-col="deposits_new"]')).toHaveText('0')
    const res = await page.request.get(`/api/reports/export?format=xlsx&from=2001-01-01&to=2001-01-02&branch=${branchA}`)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer)
    expect(wb.getWorksheet('ฝาก')!.rowCount).toBe(1) // header only
    await page.goto('/reports?from=2001-01-05&to=2001-01-02')
    await expect(page.getByText('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด')).toBeVisible()
  })
})

for (const role of ['staff', 'bar'] as const) {
  test.describe(`${role} is refused`, () => {
    test.use({ storageState: as(role) })
    test(`P4-01-05 P4-01-09 ${role}: /overview + /reports 404, RPC FORBIDDEN, export 403`, async ({ page }) => {
      for (const path of ['/overview', '/reports']) {
        const res = await page.goto(path)
        expect(res?.status()).toBe(404)
      }
      const { error } = await dbAs(role).rpc('owner_overview', { p_from: '2026-09-01', p_to: '2026-09-30' })
      expect(error?.message).toContain('FORBIDDEN')
      const { error: repErr } = await dbAs(role).rpc('owner_report', { p_from: '2026-09-01', p_to: '2026-09-30' })
      expect(repErr?.message).toContain('FORBIDDEN')
      const res = await page.request.get('/api/reports/export?format=xlsx&from=2026-09-01&to=2026-09-30')
      expect(res.status()).toBe(403)
    })
  })
}

test('P4-01-09 anon export → 401', async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const res = await ctx.get('/api/reports/export?format=pdf&from=2026-09-01&to=2026-09-30')
  expect(res.status()).toBe(401)
  await ctx.dispose()
})
