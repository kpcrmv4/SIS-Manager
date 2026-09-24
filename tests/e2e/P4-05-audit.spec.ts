import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds, sql } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { BRANCH_A_NAME } from './fixtures/users'
import { cleanupRun, mustCreate } from './fixtures/deposits'
import { addDays, bangkokDate, businessNight } from '../../src/lib/date'
import { AUDIT_KINDS } from '../../src/lib/audit/view'

/**
 * P4-05 — the audit log (R-038): every change lands with who / when / what, only the owner reads
 * it and no one edits it, and /audit filters it by kind of work. Fixture branch A; the rows this
 * file causes are checked against SQL.
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const RUN = `E2EAU-${Date.now().toString(36)}`
const LINE_USER = `U${'a0d1'.repeat(8)}`
const USERNAME = `au${RUN.slice(-6)}`.toLowerCase()
const TODAY = bangkokDate()
const DAY = { p_from: `${TODAY}T00:00:00+07:00`, p_to: `${addDays(TODAY, 1)}T00:00:00+07:00` }
let zoneId = ''
let tableId = ''
const tableLabel = `AU${RUN.slice(-4)}`
let depositCode = ''
let bookingCode = ''
let newUserId = ''

const lastRow = async (action: string, target: string) =>
  (await adminDb().from('audit_log').select('*').eq('action', action).eq('target', target).order('id', { ascending: false }).limit(1)).data?.[0]

test.beforeAll(async () => {
  const { branchA } = fixtureIds()
  const admin = adminDb()
  // a zone and table of our own; the owner changes the seats through the app's own path (RLS)
  zoneId = (await admin.from('table_zones').insert({ branch_id: branchA, name: `${RUN} โซน`, sort: 70 }).select('id').single()).data!.id
  tableId = (await admin.from('tables').insert({ branch_id: branchA, zone_id: zoneId, label: tableLabel, seats_min: 1, seats_max: 4 }).select('id').single()).data!.id
  const upd = await dbAs('owner').from('tables').update({ seats_max: 6 }).eq('id', tableId).select('id')
  expect(upd.error, upd.error?.message).toBeNull()
  // a deposit received by staff
  depositCode = (await mustCreate('staff', { qty: 1 })).code
  // a customer's LINE booking, then bar cancels it
  const c = await admin.from('customers').upsert({ line_user_id: LINE_USER, display_name: `${RUN} LINE`, locale: 'th' }, { onConflict: 'line_user_id' }).select('id').single()
  const bk = await admin.rpc('create_booking', { p_branch: branchA, p_night: addDays(businessNight(), 3), p_slot: '21:00:00', p_party: 2, p_name: `${RUN} ลูกค้า`, p_customer_id: c.data!.id } as never)
  expect(bk.error, bk.error?.message).toBeNull()
  bookingCode = (bk.data as { code: string }).code
  const cancel = await dbAs('bar').rpc('cancel_booking', { p_booking: (bk.data as { id: string }).id, p_reason: `${RUN} เหตุผล` } as never)
  expect(cancel.error, cancel.error?.message).toBeNull()
})

test.afterAll(async () => {
  const admin = adminDb()
  await admin.from('bookings').delete().like('name', `${RUN}%`)
  await admin.from('table_zones').delete().eq('id', zoneId)
  await admin.from('customers').delete().eq('line_user_id', LINE_USER)
  if (newUserId) await admin.auth.admin.deleteUser(newUserId)
  await cleanupRun()
})

for (const role of ['staff', 'bar'] as const) {
  test.describe(role, () => {
    test.use({ storageState: as(role) })
    test(`P4-05-02 ${role}: /audit is 404, the log reads empty, audit_feed is refused`, async ({ page }) => {
      const { branchA } = fixtureIds()
      expect((await page.goto('/audit'))?.status()).toBe(404)
      const rows = await dbAs(role).from('audit_log').select('id').eq('branch_id', branchA).range(0, 9)
      expect(rows.error, rows.error?.message).toBeNull()
      expect(rows.data).toHaveLength(0)
      expect((await dbAs(role).rpc('audit_feed', DAY)).error?.message).toContain('FORBIDDEN')
    })
  })
}

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P4-05-01 every change lands: who, when, the branch, the code or label, what changed', async ({ request }) => {
    const { branchA, users } = fixtureIds()
    expect(await lastRow('table.updated', tableLabel)).toMatchObject({
      branch_id: branchA, actor_id: users.owner, actor_name: 'E2E owner', actor_kind: 'staff', category: 'settings', details: { seats_max: [4, 6] },
    })
    expect(await lastRow('deposit.received', depositCode)).toMatchObject({ branch_id: branchA, actor_id: users.staff, actor_kind: 'staff', category: 'deposit' })
    expect(await lastRow('booking.created', bookingCode)).toMatchObject({ branch_id: branchA, actor_id: null, actor_kind: 'customer', category: 'booking' })
    expect(await lastRow('booking.cancelled', bookingCode)).toMatchObject({
      actor_id: users.bar, actor_name: 'E2E bar', actor_kind: 'staff', details: { reason: `${RUN} เหตุผล`, name: `${RUN} ลูกค้า` },
    })

    // user management through the owner's API: created, then a new password — never the password itself
    const created = await request.post(`${BASE_URL}/api/admin/users`, {
      data: { action: 'create', username: USERNAME, displayName: `${RUN} ใหม่`, role: 'staff', branchIds: [branchA], password: 'Audit-Pass-123' },
    })
    expect(created.status()).toBe(201)
    newUserId = ((await created.json()) as { id: string }).id
    const target = `${RUN} ใหม่ (@${USERNAME})`
    expect(await lastRow('user.created', target)).toMatchObject({ actor_id: users.owner, category: 'users', target_id: newUserId, details: { role: 'staff', branches: [BRANCH_A_NAME] } })
    const changed = await request.post(`${BASE_URL}/api/admin/users`, { data: { action: 'update', userId: newUserId, role: 'bar' } })
    expect(changed.status()).toBe(200)
    expect(await lastRow('user.updated', target)).toMatchObject({ details: { role: ['staff', 'bar'] } })
    const reset = await request.post(`${BASE_URL}/api/admin/users`, { data: { action: 'reset_password', userId: newUserId, password: 'Another-Pass-456' } })
    expect(reset.status()).toBe(200)
    expect(await lastRow('user.password_reset', target)).toBeTruthy()
    const { data: mine } = await adminDb().from('audit_log').select('details').eq('target_id', newUserId)
    expect(JSON.stringify(mine)).not.toContain('Pass-')
  })

  test('P4-05-02 owner reads every row and cannot write, change or delete one', async () => {
    const { branchA } = fixtureIds()
    const own = await dbAs('owner').from('audit_log').select('id').eq('branch_id', branchA).range(0, 9)
    expect(own.data?.length).toBeGreaterThan(0)
    expect((await dbAs('owner').from('audit_log').insert({ category: 'settings', action: 'x.y' })).error).not.toBeNull()
    expect((await dbAs('owner').from('audit_log').update({ action: 'x.y' }).eq('branch_id', branchA)).error).not.toBeNull()
    expect((await dbAs('owner').from('audit_log').delete().eq('branch_id', branchA)).error).not.toBeNull()
  })

  test('P4-05-03 /audit: every kind\'s count equals SQL; a kind shows only its rows; a search on a code', async ({ page }) => {
    const { branchA } = fixtureIds()
    const base = `/audit?from=${TODAY}&to=${TODAY}&branch=${branchA}`
    await expect(async () => {
      const rows = await sql<{ category: string; n: number }>(
        `select category, count(*)::int as n from public.audit_log where branch_id = '${branchA}' and at >= '${DAY.p_from}' and at < '${DAY.p_to}' group by category`,
      )
      const counts = Object.fromEntries(rows.map((r) => [r.category, r.n]))
      await page.goto(base)
      for (const k of AUDIT_KINDS) {
        await expect(page.locator(`[data-testid="audit-kinds"] [data-kind="${k}"]`), k).toHaveAttribute('data-count', String(counts[k] ?? 0), { timeout: 1_000 })
      }
    }).toPass({ timeout: 45_000 })

    await page.locator('[data-testid="audit-kinds"] [data-kind="booking"]').click()
    await expect(page).toHaveURL(/kind=booking/)
    const kinds = await page.getByTestId('audit-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
    expect(kinds.length).toBeGreaterThan(0)
    expect([...new Set(kinds)]).toEqual(['booking'])

    await page.goto(`${base}&q=${encodeURIComponent(bookingCode)}`)
    const targets = await page.getByTestId('audit-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-target')))
    expect(targets.length).toBeGreaterThanOrEqual(2) // created + cancelled
    expect(targets.every((x) => x === bookingCode)).toBe(true)
  })

  test('P4-05-04 a row reads who, when and what; รายละเอียด unfolds old → new; no sideways scroll on a phone', async ({ page }) => {
    const { branchA } = fixtureIds()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/audit?from=${TODAY}&to=${TODAY}&branch=${branchA}&q=${encodeURIComponent(tableLabel)}`)
    const row = page.locator(`[data-testid="audit-row"][data-action="table.updated"][data-target="${tableLabel}"]`).first()
    await expect(row).toContainText('แก้ไขโต๊ะ')
    await expect(row.getByTestId('audit-who')).toHaveText('E2E owner')
    await row.getByTestId('audit-details').click()
    const change = row.locator('[data-testid="audit-change"][data-key="seats_max"]')
    await expect(change).toBeVisible()
    await expect(change.locator('.old')).toHaveText('4')
    await expect(change.locator('.new')).toHaveText('6')
    await expect(row).toContainText('ที่นั่งสูงสุด')

    await page.goto(`/audit?from=${TODAY}&to=${TODAY}&branch=${branchA}&q=${encodeURIComponent(bookingCode)}`)
    const cancelled = page.locator('[data-testid="audit-row"][data-action="booking.cancelled"]').first()
    await expect(cancelled).toContainText('ยกเลิกการจอง')
    await expect(cancelled.getByTestId('audit-who')).toHaveText('E2E bar')
    await expect(page.locator('[data-testid="audit-row"][data-action="booking.created"]').first().getByTestId('audit-who')).toHaveText('ลูกค้า (LINE)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  })
})
