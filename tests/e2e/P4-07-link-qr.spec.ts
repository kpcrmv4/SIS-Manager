import { createHash, randomBytes, randomInt } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { adminDb, anonDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { RUN, cleanupRun, deposit, photo } from './fixtures/deposits'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import { signCustomerToken } from './fixtures/p2c-token'
import { BRANCH_A_CODE, type FixtureRole } from './fixtures/users'

/**
 * P4-07 — ผูก LINE ด้วย QR ที่พนักงานยื่นให้ลูกค้าสแกน (R-058): a one-time, 10-minute token the
 * sheet kills on close; the scan links the deposit and every open deposit of that phone here.
 * Every phone is fresh per run, so no other spec's deposit (081-234-5678) is ever touched.
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const PHONE_VIEW = { width: 390, height: 844 }
const LIFF_ID = '1234567890-LinkQrE2E'
const BOT_ID = '@e2elinkqr'
const codeLower = BRANCH_A_CODE.toLowerCase()

type Mobile = { key: string; dashed: string; intl: string }
function mobile(): Mobile {
  const key = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`
  return { key, dashed: `${key.slice(0, 3)}-${key.slice(3, 6)}-${key.slice(6)}`, intl: `+66 ${key.slice(1, 3)} ${key.slice(3, 6)} ${key.slice(6)}` }
}

let before: { liff_id: string | null; line_bot_user_id: string | null } | null = null
const lineIds: string[] = []

async function customer(name?: string) {
  const c = await makeCustomer(name ? { name } : {})
  lineIds.push(c.line_user_id)
  return c
}

async function createDep(opts: { phone?: string | null; role?: FixtureRole; branch?: 'A' | 'B' } = {}) {
  const { branchA, branchB } = fixtureIds()
  const { data, error } = await dbAs(opts.role ?? 'staff').rpc('create_deposit', {
    p_branch: opts.branch === 'B' ? branchB : branchA,
    p_customer_name: `${RUN} ลูกค้า QR`,
    p_item_name: 'Chivas Regal 12',
    p_quantity: 1,
    p_photo_paths: [await photo(opts.branch ?? 'A')],
    p_customer_phone: opts.phone ?? undefined,
    p_table: 'A1',
  })
  expect(error, error?.message).toBeNull()
  return data as { id: string; code: string }
}

async function issue(depId: string, role: FixtureRole = 'staff') {
  return dbAs(role).rpc('issue_link_qr', { p_deposit: depId })
}

async function mustIssue(depId: string, role: FixtureRole = 'staff') {
  const { data, error } = await issue(depId, role)
  expect(error, error?.message).toBeNull()
  return data as { token: string; expires_at: string; liff_id: string; known: boolean; known_name: string | null; also: number }
}

type ScanResult = { ok: boolean; error?: string; already?: boolean; returning?: boolean; linked?: number; code?: string }
async function scan(customerId: string, token: string): Promise<ScanResult> {
  const { branchA } = fixtureIds()
  const { data, error } = await adminDb().rpc('customer_link_by_qr', { p_branch: branchA, p_customer: customerId, p_token: token })
  expect(error, error?.message).toBeNull()
  return data as ScanResult
}

async function ownerOf(depId: string) {
  return (await deposit(depId)).customer_id as string | null
}

async function linkDirect(depId: string, customerId: string) {
  const row = await deposit(depId)
  const { error } = await adminDb().rpc('link_deposit_customer', { p_branch: row.branch_id, p_token: row.link_token, p_customer_id: customerId })
  expect(error, error?.message).toBeNull()
}

async function withCustomerDouble(page: Page, token: string) {
  await page.addInitScript((t) => {
    ;(window as unknown as { __SIS_LIFF_TEST__?: { customerToken: string } }).__SIS_LIFF_TEST__ = { customerToken: t }
  }, token)
}

test.beforeAll(async () => {
  const { branchA } = fixtureIds()
  const admin = adminDb()
  const { data } = await admin.from('branches').select('liff_id, line_bot_user_id').eq('id', branchA).single()
  before = data
  const { error } = await admin.from('branches').update({ liff_id: LIFF_ID, line_bot_user_id: BOT_ID }).eq('id', branchA)
  expect(error, error?.message).toBeNull()
})

test.afterAll(async () => {
  const { branchA } = fixtureIds()
  const admin = adminDb()
  if (lineIds.length) await admin.from('line_link_failures').delete().in('line_user_id', lineIds)
  await cleanupRun()
  await cleanupCustomers()
  await admin.from('branches').update({ liff_id: before?.liff_id ?? null, line_bot_user_id: before?.line_bot_user_id ?? null }).eq('id', branchA)
})

test('P4-07-01 make the QR: a 10-minute token, stored hashed; linked / closed / other branch / no LIFF refused', async () => {
  const p = mobile()
  const dep = await createDep({ phone: p.dashed })
  for (const role of ['staff', 'bar', 'owner'] as const) {
    const qr = await mustIssue(dep.id, role)
    expect(qr.token).toMatch(/^[0-9a-f]{32}$/)
    expect(qr.liff_id).toBe(LIFF_ID)
    const minutes = (new Date(qr.expires_at).getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(9)
    expect(minutes).toBeLessThanOrEqual(10.1)
    const { data: row } = await adminDb().from('deposit_link_qr').select('token_hash').eq('deposit_id', dep.id).single()
    expect(row!.token_hash).toBe(createHash('sha256').update(qr.token).digest('hex'))
  }

  const { error: other } = await issue(dep.id, 'staffB')
  expect(other?.message).toBe('FORBIDDEN')

  const c = await customer()
  const linked = await createDep({ phone: mobile().dashed })
  await linkDirect(linked.id, c.id)
  expect((await issue(linked.id)).error?.message).toBe('ALREADY_LINKED')

  const closed = await createDep({ phone: mobile().dashed })
  const { error: rejErr } = await dbAs('bar').rpc('reject_deposit', { p_deposit: closed.id, p_reason: 'e2e' })
  expect(rejErr, rejErr?.message).toBeNull()
  expect((await issue(closed.id)).error?.message).toBe('BAD_STATE')

  const { branchA } = fixtureIds()
  await adminDb().from('branches').update({ liff_id: null }).eq('id', branchA)
  try {
    expect((await issue(dep.id)).error?.message).toBe('NO_LIFF')
  } finally {
    await adminDb().from('branches').update({ liff_id: LIFF_ID }).eq('id', branchA)
  }
})

test('P4-07-02 one scan, ten minutes, dead once the sheet closes or a new QR is made', async () => {
  const c = await customer()
  // the same token twice
  const a = await createDep({ phone: mobile().dashed })
  const qa = await mustIssue(a.id)
  expect((await scan(c.id, qa.token)).ok).toBe(true)
  expect(await scan(c.id, qa.token)).toMatchObject({ ok: false, error: 'EXPIRED' })

  const other = await customer()
  // past its ten minutes
  const b = await createDep({ phone: mobile().dashed })
  const qb = await mustIssue(b.id)
  await adminDb().from('deposit_link_qr').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('deposit_id', b.id)
  expect(await scan(other.id, qb.token)).toMatchObject({ ok: false, error: 'EXPIRED' })
  // the sheet closed
  const qb2 = await mustIssue(b.id)
  const { error: revokeErr } = await dbAs('staff').rpc('revoke_link_qr', { p_deposit: b.id })
  expect(revokeErr, revokeErr?.message).toBeNull()
  expect(await scan(other.id, qb2.token)).toMatchObject({ ok: false, error: 'EXPIRED' })
  // a newer QR replaces the older
  const old = await mustIssue(b.id)
  const fresh = await mustIssue(b.id)
  expect(await scan(other.id, old.token)).toMatchObject({ ok: false, error: 'EXPIRED' })
  expect(await ownerOf(b.id)).toBeNull()
  expect((await scan(other.id, fresh.token)).ok).toBe(true)
  expect(await ownerOf(b.id)).toBe(other.id)
  await adminDb().from('line_link_failures').delete().in('line_user_id', [c.line_user_id, other.line_user_id])
})

test('P4-07-03 the scan links every open deposit of that phone here, and nothing else', async () => {
  const p = mobile()
  const scanned = await createDep({ phone: p.dashed })
  const sameIntl = await createDep({ phone: p.intl })
  const sameDigits = await createDep({ phone: p.key })
  const otherPhone = await createDep({ phone: mobile().dashed })
  const otherBranch = await createDep({ phone: p.dashed, role: 'staffB', branch: 'B' })
  const closed = await createDep({ phone: p.dashed })
  await dbAs('bar').rpc('reject_deposit', { p_deposit: closed.id, p_reason: 'e2e' })

  const qr = await mustIssue(scanned.id)
  expect(qr).toMatchObject({ known: false, also: 2 })
  const c = await customer()
  const r = await scan(c.id, qr.token)
  expect(r).toMatchObject({ ok: true, already: false, returning: false, linked: 3, code: scanned.code })

  for (const d of [scanned, sameIntl, sameDigits]) expect(await ownerOf(d.id)).toBe(c.id)
  for (const d of [otherPhone, otherBranch, closed]) expect(await ownerOf(d.id)).toBeNull()

  const { data: events } = await adminDb().from('deposit_events').select('deposit_id, actor_kind, payload').eq('action', 'line_linked').in('deposit_id', [scanned.id, sameIntl.id, sameDigits.id])
  expect(events).toHaveLength(3)
  for (const e of events!) {
    expect(e.actor_kind).toBe('customer')
    expect(e.payload).toMatchObject({ via: 'qr', count: 3, returning: false, scanned: e.deposit_id === scanned.id })
  }
})

test('P4-07-04 a phone that is already another LINE customer\'s links only the scanned deposit', async () => {
  const p = mobile()
  const owner = await customer(`${RUN} เจ้าของเบอร์`)
  const theirs = await createDep({ phone: p.dashed })
  await linkDirect(theirs.id, owner.id)
  const scanned = await createDep({ phone: p.dashed })
  const sibling = await createDep({ phone: p.key })

  const qr = await mustIssue(scanned.id)
  expect(qr).toMatchObject({ known: true, known_name: `${RUN} เจ้าของเบอร์`, also: 0 })
  const stranger = await customer()
  expect(await scan(stranger.id, qr.token)).toMatchObject({ ok: true, linked: 1 })
  expect(await ownerOf(scanned.id)).toBe(stranger.id)
  expect(await ownerOf(sibling.id)).toBeNull()
  expect(await ownerOf(theirs.id)).toBe(owner.id)
})

test('P4-07-05 new or returning: a LINE account that already has a deposit or a booking is returning', async () => {
  const c = await customer()
  const first = await createDep({ phone: mobile().dashed })
  expect(await scan(c.id, (await mustIssue(first.id)).token)).toMatchObject({ ok: true, returning: false })
  const second = await createDep({ phone: mobile().dashed })
  expect(await scan(c.id, (await mustIssue(second.id)).token)).toMatchObject({ ok: true, returning: true })
})

test('P4-07-06 scanned again after forgetting: already mine says so and still links the rest; someone else\'s is NOT_YOURS', async () => {
  const p = mobile()
  const a = await createDep({ phone: p.dashed })
  const b = await createDep({ phone: p.dashed })
  const qa = await mustIssue(a.id)
  const qb = await mustIssue(b.id)
  const c = await customer()
  expect(await scan(c.id, qa.token)).toMatchObject({ ok: true, linked: 2 })
  // b was linked by a's scan; its own QR (still up) now says "already yours"
  const late = await createDep({ phone: p.intl })
  expect(await scan(c.id, qb.token)).toMatchObject({ ok: true, already: true, returning: true, linked: 1, code: b.code })
  expect(await ownerOf(late.id)).toBe(c.id)

  const d = await createDep({ phone: mobile().dashed })
  const qd = await mustIssue(d.id)
  const someoneElse = await customer()
  await linkDirect(d.id, someoneElse.id)
  expect(await scan(c.id, qd.token)).toMatchObject({ ok: false, error: 'NOT_YOURS' })
  expect(await ownerOf(d.id)).toBe(someoneElse.id)
})

test.describe('P4-07-07 the staff sheet', () => {
  test.use({ storageState: as('staff'), viewport: PHONE_VIEW })

  test('P4-07-07 the sheet: history line, QR, countdown; the scan turns it green; closing kills the QR', async ({ page }) => {
    const p = mobile()
    const dep = await createDep({ phone: p.dashed })
    await createDep({ phone: p.key })

    await page.goto(`/deposits/${dep.id}`)
    const openBtn = page.getByTestId('link-qr-open')
    await expect(openBtn).toBeVisible()
    await openBtn.click()
    const sheet = page.getByTestId('link-qr-sheet')
    await expect(sheet).toHaveAttribute('data-state', 'qr')
    await expect(page.getByTestId('link-qr-history')).toHaveAttribute('data-known', 'false')
    await expect(page.getByTestId('link-qr-history')).toContainText('ลูกค้าใหม่')
    await expect(page.getByTestId('link-qr-also')).toContainText('1')
    await expect(page.getByTestId('link-qr-countdown')).toContainText(/หมดอายุใน [0-9]+:[0-9]{2}/)
    const url = await page.getByTestId('link-qr-image').getAttribute('data-url')
    expect(url).toMatch(new RegExp(`^https://liff\\.line\\.me/${LIFF_ID}/link\\?t=[0-9a-f]{32}$`))
    const noSideways = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(noSideways).toBe(true)

    const c = await customer(`${RUN} ลูกค้าสแกน`)
    expect((await scan(c.id, url!.split('t=')[1])).ok).toBe(true)
    const done = page.getByTestId('link-qr-linked')
    await expect(done).toBeVisible({ timeout: 15_000 })
    await expect(done).toHaveAttribute('data-returning', 'false')
    await expect(done).toContainText(`ลูกค้าใหม่ · ${RUN} ลูกค้าสแกน`)
    await expect(page.getByTestId('link-qr-count')).toContainText('2')
    await page.getByTestId('link-qr-close').click()
    await expect(page.getByTestId('deposit-customer')).toContainText('เชื่อม LINE แล้ว')
    await expect(openBtn).toHaveCount(0)

    // a sheet closed without a scan leaves no live QR behind
    const other = await createDep({ phone: mobile().dashed })
    await page.goto(`/deposits/${other.id}`)
    await page.getByTestId('link-qr-open').click()
    await expect(page.getByTestId('link-qr-sheet')).toHaveAttribute('data-state', 'qr')
    await expect.poll(async () => (await adminDb().from('deposit_link_qr').select('deposit_id').eq('deposit_id', other.id)).data?.length).toBe(1)
    await page.getByTestId('link-qr-close').click()
    await expect.poll(async () => (await adminDb().from('deposit_link_qr').select('deposit_id').eq('deposit_id', other.id)).data?.length).toBe(0)
  })
})

test('P4-07-08 the LIFF page spends the token once and says what happened', async ({ page }) => {
  const { branchA } = fixtureIds()
  const c = await customer()
  const dep = await createDep({ phone: mobile().dashed })
  const qr = await mustIssue(dep.id)
  await withCustomerDouble(page, signCustomerToken(c.id, branchA))

  await page.goto(`/liff/${codeLower}/link?t=${qr.token}`)
  const done = page.getByTestId('cx-link-done')
  await expect(done).toBeVisible()
  await expect(done).toHaveAttribute('data-returning', 'false')
  await expect(done).toHaveAttribute('data-linked', '1')
  await expect(page.getByTestId('cx-link-add-friend')).toHaveAttribute('href', `https://line.me/R/ti/p/${encodeURIComponent(BOT_ID)}`)
  expect(await ownerOf(dep.id)).toBe(c.id)

  // the same QR again: used
  await page.reload()
  await expect(page.getByTestId('cx-link-failed')).toHaveAttribute('data-error', 'EXPIRED')
  await expect(page.getByTestId('cx-link-failed')).toContainText('หมดอายุหรือถูกใช้ไปแล้ว')

  // no token at all
  await page.goto(`/liff/${codeLower}/link`)
  await expect(page.getByTestId('cx-link-failed')).toHaveAttribute('data-error', 'missing')

  // someone else's deposit
  const theirs = await createDep({ phone: mobile().dashed })
  const qt = await mustIssue(theirs.id)
  await linkDirect(theirs.id, (await customer()).id)
  await page.goto(`/liff/${codeLower}/link?t=${qt.token}`)
  await expect(page.getByTestId('cx-link-failed')).toHaveAttribute('data-error', 'NOT_YOURS')

  // a returning customer is welcomed back, no add-friend card
  const next = await createDep({ phone: mobile().dashed })
  await page.goto(`/liff/${codeLower}/link?t=${(await mustIssue(next.id)).token}`)
  await expect(page.getByTestId('cx-link-done')).toHaveAttribute('data-returning', 'true')
  await expect(page.getByTestId('cx-link-done')).toContainText('ยินดีต้อนรับกลับ')
  await expect(page.getByTestId('cx-link-add-friend')).toHaveCount(0)
  await page.getByTestId('cx-link-bottles').click()
  await expect(page.locator(`[data-code="${next.code}"]`)).toBeVisible()
  await adminDb().from('line_link_failures').delete().eq('line_user_id', c.line_user_id)
})

test('P4-07-09 who may: service role only for the scan, no direct read of the QR table, a throttle on misses', async () => {
  const { branchA } = fixtureIds()
  const c = await customer()
  const dep = await createDep({ phone: mobile().dashed })
  const qr = await mustIssue(dep.id)

  for (const db of [dbAs('staff'), dbAs('owner'), anonDb()]) {
    const { error } = await db.rpc('customer_link_by_qr', { p_branch: branchA, p_customer: c.id, p_token: qr.token })
    expect(error).not.toBeNull()
    const { data } = await db.from('deposit_link_qr').select('deposit_id').eq('deposit_id', dep.id)
    expect(data ?? []).toHaveLength(0)
  }
  expect(await ownerOf(dep.id)).toBeNull()

  for (let i = 0; i < 5; i++) expect(await scan(c.id, randomBytes(16).toString('hex'))).toMatchObject({ ok: false, error: 'EXPIRED' })
  // the right token after five misses is still refused until the window passes
  expect(await scan(c.id, qr.token)).toMatchObject({ ok: false, error: 'THROTTLED' })
  expect(await ownerOf(dep.id)).toBeNull()
  await adminDb().from('line_link_failures').delete().eq('line_user_id', c.line_user_id)
  expect((await scan(c.id, qr.token)).ok).toBe(true)
})

// ── R-059 · the phone decides at the counter ─────────────────────────────

/** A phone that one LINE customer owns here: their deposit with it, linked. */
async function ownedPhone(name: string) {
  const p = mobile()
  const c = await customer(name)
  const d = await createDep({ phone: p.dashed })
  await linkDirect(d.id, c.id)
  return { p, c }
}

async function createWithPhone(phone: string, choice: 'owner' | 'shared' | null, customerId?: string) {
  const { branchA } = fixtureIds()
  return dbAs('staff').rpc('create_deposit_with_phone', {
    p_branch: branchA,
    p_customer_name: `${RUN} ลูกค้าเบอร์`,
    p_item_name: 'Chivas Regal 12',
    p_quantity: 1,
    p_photo_paths: [await photo('A')],
    p_customer_phone: phone,
    p_phone_choice: choice ?? undefined,
    p_phone_customer: customerId,
  })
}

test('P4-07-11 whose phone: the owner in any format; nothing for a new phone, a shared one, or another branch', async () => {
  const { branchA, branchB } = fixtureIds()
  const { p, c } = await ownedPhone(`${RUN} เจ้าของเบอร์ 11`)
  for (const typed of [p.dashed, p.intl, p.key]) {
    const { data, error } = await dbAs('staff').rpc('phone_customer', { p_branch: branchA, p_phone: typed })
    expect(error, error?.message).toBeNull()
    expect(data).toMatchObject({ customer_id: c.id, name: `${RUN} เจ้าของเบอร์ 11`, last_name: `${RUN} ลูกค้า QR`, open: 1 })
  }
  expect((await dbAs('staff').rpc('phone_customer', { p_branch: branchA, p_phone: mobile().dashed })).data).toBeNull()
  // two LINE customers on one phone → nobody owns it
  const second = await customer()
  const d2 = await createDep({ phone: p.key })
  await linkDirect(d2.id, second.id)
  expect((await dbAs('staff').rpc('phone_customer', { p_branch: branchA, p_phone: p.dashed })).data).toBeNull()
  expect((await dbAs('staff').rpc('phone_customer', { p_branch: branchB, p_phone: p.dashed })).error?.message).toBe('FORBIDDEN')
})

test('P4-07-12 receive with the phone settled: linked from birth, the wrong customer refused whole, a shared phone never links along', async () => {
  const { p, c } = await ownedPhone(`${RUN} เจ้าของเบอร์ 12`)
  const { data, error } = await createWithPhone(p.intl, 'owner', c.id)
  expect(error, error?.message).toBeNull()
  const linked = data as { id: string }
  expect(await ownerOf(linked.id)).toBe(c.id)
  const { data: ev } = await adminDb().from('deposit_events').select('payload, actor_kind').eq('deposit_id', linked.id).eq('action', 'line_linked').single()
  expect(ev).toMatchObject({ actor_kind: 'staff', payload: { via: 'phone' } })

  // naming someone who does not own the phone creates nothing
  const stranger = await customer()
  const { count: before } = await adminDb().from('deposits').select('id', { count: 'exact', head: true }).like('customer_name', `${RUN}%`)
  expect((await createWithPhone(p.dashed, 'owner', stranger.id)).error?.message).toBe('NOT_PHONE_OWNER')
  const { count: after } = await adminDb().from('deposits').select('id', { count: 'exact', head: true }).like('customer_name', `${RUN}%`)
  expect(after).toBe(before)

  // a shared phone: unlinked, marked, and left alone when the owner scans another deposit of that phone
  const shared = (await createWithPhone(p.dashed, 'shared')).data as { id: string }
  expect(await ownerOf(shared.id)).toBeNull()
  expect((await deposit(shared.id)).phone_shared).toBe(true)
  const other = await createDep({ phone: p.key })
  expect(await scan(c.id, (await mustIssue(other.id)).token)).toMatchObject({ ok: true, linked: 1 })
  expect(await ownerOf(shared.id)).toBeNull()
  // its own QR still links it
  const sharer = await customer()
  expect(await scan(sharer.id, (await mustIssue(shared.id)).token)).toMatchObject({ ok: true, linked: 1 })
  expect(await ownerOf(shared.id)).toBe(sharer.id)
})

test.describe('P4-07-13 the receive form and the sheet', () => {
  test.use({ storageState: as('staff'), viewport: PHONE_VIEW })
  const PHOTO = join(tmpdir(), `p407-${Date.now()}.jpg`)

  async function fillForm(page: Page, phone: string, name = '') {
    writeFileSync(PHOTO, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]))
    await page.goto('/deposits/new')
    await expect(page.getByTestId('new-deposit-form')).toHaveAttribute('data-hydrated', 'true')
    if (name) await page.getByTestId('deposit-name').fill(name)
    await page.getByTestId('deposit-item').fill('Chivas Regal 12')
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('deposit-photo-add').click()
    await (await chooser).setFiles(PHOTO)
    await expect(page.getByTestId('photo-chip').first()).toBeVisible()
    await page.getByTestId('deposit-phone').fill(phone)
  }

  test('P4-07-13 a known phone asks; yes links at once, no sends back to the phone, shared saves unlinked', async ({ page }) => {
    const { p, c } = await ownedPhone(`${RUN} เจ้าของเบอร์ 13`)

    // yes: the name fills from their last deposit, the deposit is born linked
    await fillForm(page, p.intl)
    await expect(page.getByTestId('phone-owner-name')).toHaveText(`${RUN} เจ้าของเบอร์ 13`)
    // the question must be answered
    await page.getByTestId('deposit-submit').click()
    await expect(page.getByTestId('phone-owner-card')).toContainText('เลือกว่าใช่ลูกค้าคนนี้ไหม')
    await page.getByTestId('phone-owner-yes').click()
    await expect(page.getByTestId('deposit-name')).toHaveValue(`${RUN} ลูกค้า QR`)
    await expect(page.getByTestId('phone-owner-chosen')).toHaveAttribute('data-choice', 'owner')
    await page.getByTestId('deposit-submit').click()
    await page.waitForURL(/\/deposits\/[0-9a-f-]{36}$/)
    const yesId = page.url().split('/').pop()!
    expect(await ownerOf(yesId)).toBe(c.id)
    await expect(page.getByTestId('deposit-customer')).toContainText('เชื่อม LINE แล้ว')

    // no: back to the phone, cannot save until fixed or shared
    await fillForm(page, p.dashed, `${RUN} คนอื่น`)
    await page.getByTestId('phone-owner-no').click()
    await expect(page.getByTestId('phone-owner-denied')).toContainText('ตรวจเบอร์อีกครั้ง')
    await expect(page.getByTestId('deposit-phone')).toBeFocused()
    await page.getByTestId('deposit-submit').click()
    await expect(page.getByTestId('phone-owner-denied')).toContainText('แก้เบอร์ หรือเลือกใช้เบอร์ร่วมกัน')
    await expect(page).toHaveURL(/\/deposits\/new$/)
    // shared: saved without LINE, marked shared
    await page.getByTestId('phone-owner-shared').click()
    await expect(page.getByTestId('phone-owner-chosen')).toHaveAttribute('data-choice', 'shared')
    await page.getByTestId('deposit-submit').click()
    await page.waitForURL(/\/deposits\/[0-9a-f-]{36}$/)
    const sharedId = page.url().split('/').pop()!
    expect(await ownerOf(sharedId)).toBeNull()
    expect((await deposit(sharedId)).phone_shared).toBe(true)

    // a new phone: no question at all
    await fillForm(page, mobile().dashed, `${RUN} ลูกค้าใหม่`)
    await page.waitForTimeout(900)
    await expect(page.getByTestId('phone-owner-card')).toHaveCount(0)
    await page.getByTestId('deposit-submit').click()
    await page.waitForURL(/\/deposits\/[0-9a-f-]{36}$/)
    expect(await ownerOf(page.url().split('/').pop()!)).toBeNull()
  })

  test('P4-07-14 an older deposit of a known phone links to its owner from the QR sheet, no scan', async ({ page }) => {
    const { p, c } = await ownedPhone(`${RUN} เจ้าของเบอร์ 14`)
    const old = await createDep({ phone: p.key })
    await page.goto(`/deposits/${old.id}`)
    await page.getByTestId('link-qr-open').click()
    await expect(page.getByTestId('link-qr-history')).toHaveAttribute('data-known', 'true')
    await page.getByTestId('link-qr-owner').click()
    await expect(page.getByTestId('link-qr-linked')).toContainText(`ลูกค้าเดิม · ${RUN} เจ้าของเบอร์ 14`)
    expect(await ownerOf(old.id)).toBe(c.id)
    expect((await adminDb().from('deposit_link_qr').select('deposit_id').eq('deposit_id', old.id)).data).toHaveLength(0)
    await page.getByTestId('link-qr-close').click()
    await expect(page.getByTestId('deposit-customer')).toContainText('เชื่อม LINE แล้ว')
    // the owner no longer owning it (a second LINE customer on the phone) → refused
    const later = await createDep({ phone: p.key })
    const second = await customer()
    const d2 = await createDep({ phone: p.dashed })
    await linkDirect(d2.id, second.id)
    expect((await dbAs('staff').rpc('link_phone_owner', { p_deposit: later.id, p_customer: c.id })).error?.message).toBe('NOT_PHONE_OWNER')
  })
})
