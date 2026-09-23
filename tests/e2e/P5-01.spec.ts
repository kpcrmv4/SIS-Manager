import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
import { env } from './fixtures/env'

/**
 * P5-01 — demo reset + seed + one-tap demo login. The reset only touches SRC (R-029) and
 * demo.* accounts; it seeds ~30 rows per run (well under the 1,000-row rule, R-024).
 */
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
// the one demo branch (R-029), marked receipt_settings.demo
const DEMO = ['SRC'] as const
const DEP_STATUSES = ['requested', 'pending_confirm', 'in_store', 'pending_withdrawal', 'withdrawn', 'expired', 'disposed', 'cancelled']
const BK_STATUSES = ['pending', 'confirmed', 'arrived', 'no_show', 'cancelled', 'rejected']

function reset() {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'demo-reset.mjs')], { cwd: ROOT, stdio: 'pipe', timeout: 240_000 })
}

// L-010 / R-030: the demo branch now also carries the owner's real LINE setup, and a reset re-seeds
// its data — so the specs that run the reset (or read what it seeded) are opt-in: E2E_DEMO_RESET=1
const RESET_ON = process.env.E2E_DEMO_RESET === '1'
const RESET_SKIP = 'runs demo:reset on the shared project — opt-in with E2E_DEMO_RESET=1'

async function demoBranchIds(): Promise<Record<string, string>> {
  const { data, error } = await adminDb().from('branches').select('id, code, active').in('code', [...DEMO])
  expect(error, error?.message).toBeNull()
  expect(data!.length).toBe(1)
  expect(data!.every((b) => b.active)).toBe(true)
  return Object.fromEntries(data!.map((b) => [b.code, b.id]))
}

async function statusCounts(table: 'deposits' | 'bookings', branchIds: string[]) {
  const { data, error } = await adminDb().from(table).select('status').in('branch_id', branchIds).range(0, 999)
  expect(error, error?.message).toBeNull()
  return data!.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
}

async function fixtureCounts() {
  const { branchA, branchB } = fixtureIds()
  const out: Record<string, number> = {}
  for (const t of ['deposits', 'bookings', 'tables', 'table_zones', 'booking_blackouts'] as const) {
    const { count, error } = await adminDb().from(t).select('id', { count: 'exact', head: true }).in('branch_id', [branchA, branchB])
    expect(error, error?.message).toBeNull()
    out[t] = count ?? 0
  }
  return out
}

test('P5-01-01 P5-01-02 P5-01-05 reset seeds the demo set, is idempotent, and leaves fixture branches alone', async () => {
  test.skip(!RESET_ON, RESET_SKIP)
  const before = await fixtureCounts()
  reset()
  const ids = await demoBranchIds()
  const first = { d: await statusCounts('deposits', Object.values(ids)), b: await statusCounts('bookings', Object.values(ids)) }
  reset()
  const again = await demoBranchIds()
  expect(again).toEqual(ids) // same branch rows, not new ones
  expect({ d: await statusCounts('deposits', Object.values(ids)), b: await statusCounts('bookings', Object.values(ids)) }).toEqual(first)
  expect(await fixtureCounts()).toEqual(before)

  const { data: users, error } = await adminDb().from('profiles').select('username, role, active').like('username', 'demo.%').order('username')
  expect(error, error?.message).toBeNull()
  expect(users).toEqual([
    { username: 'demo.bar', role: 'bar', active: true },
    { username: 'demo.owner', role: 'owner', active: true },
    { username: 'demo.staff', role: 'staff', active: true },
  ])
  const { count: tables } = await adminDb().from('tables').select('id', { count: 'exact', head: true }).eq('branch_id', ids.SRC)
  expect(tables).toBe(11)
})

test('P5-01-03 P5-01-04 every deposit and booking display state exists at SRC', async () => {
  test.skip(!RESET_ON, RESET_SKIP)
  const ids = await demoBranchIds()
  const dep = await statusCounts('deposits', [ids.SRC])
  for (const s of DEP_STATUSES) expect(dep[s], `deposit ${s}`).toBeGreaterThan(0)
  const bk = await statusCounts('bookings', [ids.SRC])
  for (const s of BK_STATUSES) expect(bk[s], `booking ${s}`).toBeGreaterThan(0)

  const db = adminDb()
  const { count: vip } = await db.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', ids.SRC).eq('is_vip', true)
  expect(vip).toBeGreaterThan(0)
  const soon = new Date(Date.now() + 2.5 * 86400_000).toISOString()
  const { count: near } = await db.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', ids.SRC).eq('status', 'in_store').eq('is_vip', false).lte('expires_at', soon)
  expect(near).toBeGreaterThan(0)
  const { count: linked } = await db.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', ids.SRC).not('customer_id', 'is', null)
  expect(linked).toBeGreaterThan(0)
  const { data: wd, error: wdErr } = await db.from('withdrawals').select('status').eq('branch_id', ids.SRC).range(0, 999)
  expect(wdErr, wdErr?.message).toBeNull()
  for (const s of ['pending', 'completed', 'rejected']) expect(wd!.some((w) => w.status === s), `withdrawal ${s}`).toBe(true)
  const { data: settings } = await db.from('booking_settings').select('closed_weekdays').eq('branch_id', ids.SRC).single()
  expect(settings!.closed_weekdays.length).toBeGreaterThan(0)
  const { count: blackouts } = await db.from('booking_blackouts').select('id', { count: 'exact', head: true }).eq('branch_id', ids.SRC)
  expect(blackouts).toBe(1)
})

test('P5-01-09 the reset refuses to run next to a real branch, and never adopts an unmarked demo code', async () => {
  test.skip(!RESET_ON, RESET_SKIP)
  const run = () => spawnSync(process.execPath, [join(ROOT, 'scripts', 'demo-reset.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 240_000 })
  const db = adminDb()
  // a real-looking active branch (not demo, not an E2E fixture)
  const { data: real, error } = await db.from('branches').insert({ code: 'QQRL', name: 'E2E real-branch guard' }).select('id').single()
  expect(error, error?.message).toBeNull()
  try {
    const res = run()
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('QQRL')
  } finally {
    await db.from('branches').delete().eq('id', real!.id)
  }
  // strip the marker from one demo branch: the reset must refuse to touch it
  const { data: drmi } = await db.from('branches').select('id, receipt_settings').eq('code', 'SRC').single()
  await db.from('branches').update({ receipt_settings: { header: 'not demo' } }).eq('id', drmi!.id)
  try {
    const res = run()
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('SRC')
    const { count } = await db.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', drmi!.id)
    expect(count).toBeGreaterThan(0) // nothing wiped
  } finally {
    await db.from('branches').update({ receipt_settings: drmi!.receipt_settings }).eq('id', drmi!.id)
  }
})

test('P5-01-08 a missing SEED_* password stops the reset and names the key', async () => {
  const file = join(tmpdir(), `sis-demo-env-${Date.now()}.env`)
  // dummy values only — never a real secret in a temp file
  writeFileSync(
    file,
    ['NEXT_PUBLIC_SUPABASE_URL=https://example.invalid', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy', 'SUPABASE_SECRET_KEY=dummy', 'SEED_OWNER_PASSWORD=dummy-owner-pw', 'SEED_STAFF_PASSWORD=dummy-staff-pw'].join('\n'),
  )
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'demo-reset.mjs')], { cwd: ROOT, env: { ...process.env, DEMO_RESET_ENV_FILE: file }, encoding: 'utf8' })
  expect(res.status).toBe(1)
  expect(res.stderr).toContain('SEED_BAR_PASSWORD')
  expect(res.stderr).toContain('nothing was changed')
})

// The dev server lets the shell override .env.local (with-env), the spec reads the file —
// so the switched-off run is flagged explicitly:
//   E2E_PORT=3110 E2E_DEMO_OFF=1 ENABLE_DEMO_LOGIN=false npx playwright test tests/e2e/P5-01.spec.ts -g P5-01-07
const DEMO_OFF = process.env.E2E_DEMO_OFF === '1'

test.describe('one-tap demo login', () => {
  test.skip(DEMO_OFF || env.ENABLE_DEMO_LOGIN !== 'true', 'ENABLE_DEMO_LOGIN is not true on this server')
  for (const [role, landing, marker] of [
    ['staff', '/tonight', 'ศรีราชา'],
    ['bar', '/tonight', 'ศรีราชา'],
    ['owner', '/overview', 'ศรีราชา'],
  ] as const) {
    test(`P5-01-06 ${role} lands on ${landing} with seeded data`, async ({ page }) => {
      await page.goto('/login')
      await expect(page.getByTestId('demo-staff')).toBeVisible()
      await expect(page.getByTestId('demo-bar')).toBeVisible()
      await expect(page.getByTestId('demo-owner')).toBeVisible()
      await page.getByTestId(`demo-${role}`).click()
      await expect(page).toHaveURL(new RegExp(`${landing}$`))
      await expect(page.getByText(marker).filter({ visible: true }).first()).toBeVisible()
    })
  }
})

test.describe('demo login switched off', () => {
  test.skip(!DEMO_OFF, 'run on a server started with ENABLE_DEMO_LOGIN=false and E2E_DEMO_OFF=1')
  test('P5-01-07 P0-AUTH-13 no demo buttons and the route 404s', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByTestId('demo-staff')).toHaveCount(0)
    const res = await page.request.post('/api/auth/demo', { data: { role: 'bar' } })
    expect(res.status()).toBe(404)
  })
})
