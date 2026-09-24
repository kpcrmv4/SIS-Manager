import { createHash, randomInt } from 'node:crypto'
import { join } from 'node:path'
import { expect, test, type Browser } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { RUN, cleanupRun, confirmAll, deposit, photo } from './fixtures/deposits'
import { forceExpired } from './fixtures/p2a-flows'
import { RUN as CRUN, cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import type { FixtureRole } from './fixtures/users'
import { businessNight } from '../../src/lib/date'
import type { CustomerDetail, CustomerList } from '../../src/lib/customers/view'

/**
 * P4-06 — ลูกค้า (R-048): one customer per LINE account, else phone digits, else name; the list,
 * the page, and a VIP that belongs to the customer — made, spread to later deposits, cancelled.
 * Every phone here is fresh per run, so no other spec's deposit (081-234-5678) is ever touched,
 * and afterAll removes the VIP rows it made.
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const PHONE = { width: 390, height: 844 }

type Mobile = { key: string; dashed: string; intl: string }
/** A fresh Thai mobile number: its digits, and two of the ways people type it. */
function mobile(): Mobile {
  const key = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`
  return { key, dashed: `${key.slice(0, 3)}-${key.slice(3, 6)}-${key.slice(6)}`, intl: `+66 ${key.slice(1, 3)} ${key.slice(3, 6)} ${key.slice(6)}` }
}

const P1 = mobile() // a walk-in: three deposits typed three ways, and a booking
const P2 = mobile() // a LINE customer's phone, also used on a walk-in deposit
const P3 = mobile() // one phone, two LINE customers
const P4 = mobile() // a walk-in deposit linked to LINE later
const NAME_ONLY = `${RUN} ชื่ออย่างเดียว`

let c1: { id: string }
let c2: { id: string }
let c3: { id: string }
let depA1: { id: string; code: string }
let depA2: { id: string; code: string }
let depA3: { id: string; code: string }
let depC1: { id: string; code: string }
let depC2: { id: string; code: string }
let depB: { id: string; code: string }
let bkA1: { id: string; code: string }
let depositDays = 30

async function takeDeposit(opts: { name: string; phone?: string; qty?: number; branch?: 'A' | 'B'; role?: FixtureRole }) {
  const { branchA, branchB } = fixtureIds()
  const { data, error } = await dbAs(opts.role ?? 'staff').rpc('create_deposit', {
    p_branch: opts.branch === 'B' ? branchB : branchA,
    p_customer_name: `${RUN} ${opts.name}`,
    p_item_name: 'Chivas Regal 12',
    p_quantity: opts.qty ?? 1,
    p_photo_paths: [await photo(opts.branch ?? 'A')],
    p_customer_phone: opts.phone,
    p_table: 'B2',
  })
  expect(error, error?.message).toBeNull()
  return data as { id: string; code: string }
}

async function link(depositId: string, customerId: string) {
  const row = await deposit(depositId)
  const { error } = await adminDb().rpc('link_deposit_customer', { p_branch: row.branch_id, p_token: row.link_token, p_customer_id: customerId })
  expect(error, error?.message).toBeNull()
}

async function book(name: string, phone?: string) {
  const { data, error } = await dbAs('staff').rpc('create_booking', {
    p_branch: fixtureIds().branchA,
    p_night: businessNight(),
    p_slot: '21:30:00',
    p_party: 3,
    p_name: `${RUN} ${name}`,
    p_phone: phone,
  })
  expect(error, error?.message).toBeNull()
  return data as { id: string; code: string }
}

async function list(role: FixtureRole, opts: { q?: string; filter?: string } = {}): Promise<CustomerList> {
  const { data, error } = await dbAs(role).rpc('customer_list', { p_branch: fixtureIds().branchA, p_q: opts.q, p_filter: opts.filter ?? 'all', p_limit: 100 })
  expect(error, error?.message).toBeNull()
  return data as unknown as CustomerList
}

async function detail(key: string): Promise<CustomerDetail> {
  const { data, error } = await dbAs('bar').rpc('customer_detail', { p_branch: fixtureIds().branchA, p_key: key })
  expect(error, error?.message).toBeNull()
  return data as unknown as CustomerDetail
}

// ── the rule, written again in plain code: the list must agree with it ─────
function phoneKey(p: string | null): string | null {
  const d = (p ?? '').replace(/\D/g, '')
  if (/^66\d{8,9}$/.test(d)) return `0${d.slice(2)}`
  return d.length >= 6 && d.length <= 15 ? d : null
}

async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    expect(error, error?.message).toBeNull()
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

async function referencePeople(branchId: string) {
  const admin = adminDb()
  const deps = await all((f, t) =>
    admin.from('deposits').select('id, customer_id, customer_phone, customer_name, status').eq('branch_id', branchId).order('id').range(f, t),
  )
  const bks = await all((f, t) => admin.from('bookings').select('id, customer_id, phone, name').eq('branch_id', branchId).order('id').range(f, t))
  const recs = [
    ...deps.map((d) => ({ cid: d.customer_id, k: phoneKey(d.customer_phone), nm: d.customer_name, status: d.status as string | null })),
    ...bks.map((b) => ({ cid: b.customer_id, k: phoneKey(b.phone), nm: b.name, status: null })),
  ]
  const cids = [...new Set(recs.map((r) => r.cid).filter((c): c is string => !!c))]
  const custs = cids.length ? await all((f, t) => admin.from('customers').select('id, phone').in('id', cids).order('id').range(f, t)) : []
  const owners = new Map<string, Set<string>>()
  const own = (k: string | null, cid: string) => k && owners.set(k, (owners.get(k) ?? new Set()).add(cid))
  for (const r of recs) if (r.cid) own(r.k, r.cid)
  for (const c of custs) own(phoneKey(c.phone), c.id)
  const personOf = (r: (typeof recs)[number]) => {
    if (r.cid) return `c-${r.cid}`
    const o = r.k ? owners.get(r.k) : undefined
    if (o?.size === 1) return `c-${[...o][0]}`
    if (r.k) return `p-${r.k}`
    const n = (r.nm ?? '').trim().toLowerCase()
    return n ? `n-${createHash('md5').update(n).digest('hex')}` : null
  }
  const people = new Map<string, { inStore: boolean }>()
  for (const r of recs) {
    const p = personOf(r)
    if (!p) continue
    const cur = people.get(p) ?? { inStore: false }
    if (r.status === 'in_store' || r.status === 'pending_withdrawal') cur.inStore = true
    people.set(p, cur)
  }
  return {
    all: people.size,
    inStore: [...people.values()].filter((p) => p.inStore).length,
    line: [...people.keys()].filter((k) => k.startsWith('c-')).length,
  }
}

async function phonePage(browser: Browser, role: FixtureRole) {
  const ctx = await browser.newContext({ storageState: as(role), viewport: PHONE })
  return { ctx, page: await ctx.newPage() }
}

test.beforeAll(async () => {
  const admin = adminDb()
  const { data: branch } = await admin.from('branches').select('deposit_days').eq('id', fixtureIds().branchA).single()
  depositDays = branch?.deposit_days ?? 30

  depA1 = await takeDeposit({ name: 'สมชาย', phone: P1.dashed, qty: 2 })
  await confirmAll(depA1.id, [100, 60])
  depA2 = await takeDeposit({ name: 'สมชาย ใจดี', phone: P1.key })
  depA3 = await takeDeposit({ name: 'สมชาย', phone: P1.intl })
  await confirmAll(depA3.id, [100])
  await forceExpired(depA3.id)
  bkA1 = await book('สมชาย', P1.dashed)

  c1 = await makeCustomer({ name: `${CRUN} Somchai LINE` })
  depC1 = await takeDeposit({ name: 'ลูกค้า LINE', phone: P2.dashed })
  await link(depC1.id, c1.id)
  await confirmAll(depC1.id, [100])
  depC2 = await takeDeposit({ name: 'ลูกค้า LINE หน้าร้าน', phone: P2.key })

  c2 = await makeCustomer({ name: `${CRUN} share one` })
  c3 = await makeCustomer({ name: `${CRUN} share two` })
  await link((await takeDeposit({ name: 'แชร์ 1', phone: P3.dashed })).id, c2.id)
  await link((await takeDeposit({ name: 'แชร์ 2', phone: P3.dashed })).id, c3.id)
  await takeDeposit({ name: 'แชร์ หน้าร้าน', phone: P3.key })

  await takeDeposit({ name: 'ชื่ออย่างเดียว' })
  await book('ชื่ออย่างเดียว')

  depB = await takeDeposit({ name: 'สาขาบี', phone: P1.dashed, branch: 'B', role: 'staffB' })
})

test.afterAll(async () => {
  const admin = adminDb()
  const { branchA, branchB } = fixtureIds()
  await admin
    .from('customer_vips')
    .delete()
    .in('branch_id', [branchA, branchB])
    .in('phone_key', [P1.key, P2.key, P3.key, P4.key])
  await cleanupRun()
  await admin.from('bookings').delete().eq('branch_id', branchA).like('name', `${RUN}%`)
  await cleanupCustomers() // their VIP rows go with them
})

test('P4-06-02 one person, many records: LINE, else phone digits, else name — and the figures equal the rule', async () => {
  const walkIn = await list('bar', { q: P1.key })
  expect(walkIn.rows.map((r) => r.key)).toEqual([`p-${P1.key}`])
  expect(walkIn.rows[0]).toMatchObject({ deposits: 3, bookings: 1, deposits_in_store: 1, bottles_in_store: 2, line: false, can_vip: true, is_vip: false })

  const lineCustomer = await list('bar', { q: P2.dashed })
  expect(lineCustomer.rows.map((r) => r.key)).toEqual([`c-${c1.id}`]) // the walk-in deposit with the same phone joins the LINE customer
  expect(lineCustomer.rows[0]).toMatchObject({ deposits: 2, line: true })

  const shared = await list('bar', { q: P3.key })
  expect(shared.rows.map((r) => r.key).sort()).toEqual([`c-${c2.id}`, `c-${c3.id}`, `p-${P3.key}`].sort())
  expect(shared.rows.find((r) => r.key === `p-${P3.key}`)).toMatchObject({ deposits: 1, line: false })

  const byName = await list('bar', { q: 'ชื่ออย่างเดียว' })
  expect(byName.rows).toHaveLength(1)
  expect(byName.rows[0].key).toBe(`n-${createHash('md5').update(NAME_ONLY.toLowerCase()).digest('hex')}`)
  expect(byName.rows[0]).toMatchObject({ deposits: 1, bookings: 1, can_vip: false })

  const everyone = await list('bar')
  const ref = await referencePeople(fixtureIds().branchA)
  expect(everyone.counts).toMatchObject({ all: ref.all, in_store: ref.inStore, line: ref.line })
  expect(everyone.total).toBe(ref.all)

  const d = await detail(`p-${P1.key}`)
  expect(d.deposits.total).toBe(3)
  expect(d.bookings.total).toBe(1)
  expect(d.names.sort()).toEqual([`${RUN} สมชาย`, `${RUN} สมชาย ใจดี`].sort())
  expect(d.stats).toMatchObject({ bottles_in_store: 2, deposits_in_store: 1, deposits: 3, expired: 1, bookings: 1, to_vip: 3, vip_deposits: 0 })
})

test('P4-06-01 ลูกค้า is in the menu for every role — the sidebar on a computer, the เพิ่มเติม sheet on a phone', async ({ browser }) => {
  for (const role of ['staff', 'bar', 'owner'] as const) {
    const desk = await browser.newContext({ storageState: as(role), viewport: { width: 1280, height: 800 } })
    await desk.addCookies([{ name: 'sis_branch', value: fixtureIds().branchA, url: BASE_URL }])
    const page = await desk.newPage()
    await page.goto(role === 'owner' ? '/overview' : '/tonight')
    await page.locator('nav[aria-label="เมนูหลัก"]:visible').getByRole('link', { name: 'ลูกค้า', exact: true }).click()
    await expect(page).toHaveURL(/\/customers$/)
    await expect(page.getByRole('heading', { name: 'ลูกค้า', exact: true })).toBeVisible()
    await desk.close()
  }
  const { ctx, page } = await phonePage(browser, 'staff')
  await page.goto('/tonight')
  await page.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'ลูกค้า', exact: true }).click()
  await expect(page).toHaveURL(/\/customers$/)
  await ctx.close()
})

test.describe('staff', () => {
  test.use({ storageState: as('staff') })

  test('P4-06-03 the four cards count like the list and filter it; search by name, phone in any format, a DEP or BK code', async ({ page }) => {
    const everyone = await list('staff')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/customers')
    for (const key of ['all', 'in_store', 'vip', 'line'] as const) {
      await expect(page.getByTestId(`customers-filter-${key}`)).toHaveAttribute('data-count', String(everyone.counts[key]))
    }
    await expect(page.getByTestId('customers-filter-all')).toHaveAttribute('aria-current', 'page')

    await page.getByTestId('customers-filter-line').click()
    await expect(page).toHaveURL(/filter=line/)
    await expect(page.getByTestId('customers-filter-line')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('customers-table-desktop')).toContainText(`${RUN} ลูกค้า LINE`) // the name staff typed, not the LINE one

    for (const q of [P1.dashed, P1.intl, depA2.code, bkA1.code, 'สมชาย ใจดี']) {
      await page.goto(`/customers?q=${encodeURIComponent(q)}`)
      const rows = page.getByTestId('customer-row')
      await expect(rows, q).toHaveCount(1)
      await expect(rows.first(), q).toContainText(P1.dashed)
    }
    await page.goto(`/customers?q=${encodeURIComponent(depC2.code)}`)
    await expect(page.getByTestId('customer-row')).toHaveCount(1)
    await expect(page.getByTestId('customer-row').first()).toContainText('เชื่อม LINE แล้ว')
  })

  test('P4-06-04 cards on a phone with no sideways scroll, a table on a computer; empty search; error + retry', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto(`/customers?q=${P1.key}`)
    await expect(page.getByTestId('customers-list-mobile')).toBeVisible()
    await expect(page.getByTestId('customers-table-desktop')).toBeHidden()
    await expect(page.getByTestId('customers-list-mobile')).toContainText(`${RUN} สมชาย`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/customers?q=${P1.key}`)
    await expect(page.getByTestId('customers-table-desktop')).toBeVisible()
    await expect(page.getByTestId('customers-list-mobile')).toBeHidden()

    await page.goto('/customers?q=zz-no-such-customer')
    await expect(page.getByText('ไม่พบลูกค้าที่ตรงกับ "zz-no-such-customer"', { exact: true })).toBeVisible()

    await page.goto('/customers?q=__e2e_fail__')
    await expect(page.locator('.panel[role="alert"]')).toBeVisible()
    await page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ลูกค้า', exact: true })).toBeVisible()
    await expect(page.locator('.panel[role="alert"]')).toHaveCount(0)
  })

  test('P4-06-05 a customer page: summary, contact, every deposit and booking; other keys land on it; another branch 404s', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto(`/customers/p-${P1.key}`)
    await expect(page.getByTestId('customer-header')).toHaveAttribute('data-key', `p-${P1.key}`)
    await expect(page.getByTestId('stat-in-store')).toContainText('2')
    await expect(page.getByTestId('stat-deposits')).toContainText('3')
    await expect(page.getByTestId('stat-bookings')).toContainText('1')
    await expect(page.getByTestId('customer-call').first()).toHaveAttribute('href', `tel:${P1.key}`)
    await expect(page.getByTestId('customer-other-names')).toBeVisible()
    await expect(page.getByTestId('customer-deposits').locator('.code')).toHaveCount(3 * 2) // table + rows, one of them hidden
    await expect(page.getByTestId('customer-bookings')).toContainText(bkA1.code)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width)

    await page.getByTestId('customer-deposits').getByRole('link').filter({ hasText: depA2.code }).click()
    await expect(page).toHaveURL(new RegExp(`/deposits/${depA2.id}$`))

    for (const key of [`d-${depA3.id}`, `b-${bkA1.id}`, `p-66${P1.key.slice(1)}`]) {
      await page.goto(`/customers/${key}`)
      await expect(page, key).toHaveURL(new RegExp(`/customers/p-${P1.key}$`))
    }
    await page.goto(`/customers/p-${P2.key}`)
    await expect(page).toHaveURL(new RegExp(`/customers/c-${c1.id}$`)) // a phone that belongs to a LINE customer

    for (const key of [`d-${depB.id}`, 'p-0600000001', 'c-00000000-0000-4000-8000-000000000000', 'x-nothing']) {
      const res = await page.goto(`/customers/${key}`)
      expect(res?.status(), key).toBe(404)
    }
  })

  test('P4-06-11 the deposit page and the booking sheet open the customer', async ({ page }) => {
    await page.goto(`/deposits/${depA1.id}`)
    await page.getByTestId('deposit-customer-history').click()
    await expect(page).toHaveURL(new RegExp(`/customers/p-${P1.key}$`))

    await page.goto('/scan')
    await page.getByTestId('scan-input').fill(bkA1.code)
    await page.getByRole('button', { name: 'ค้นหา', exact: true }).click()
    await page.getByTestId('booking-customer-history').click()
    await expect(page).toHaveURL(new RegExp(`/customers/p-${P1.key}$`))
  })

  test('P4-06-09 staff: sees VIP and the note, never the button; the RPC answers BAR_ONLY', async ({ page }) => {
    await page.goto(`/customers/p-${P1.key}`)
    await expect(page.getByTestId('customer-vip')).toHaveAttribute('data-vip', 'off')
    await expect(page.getByTestId('customer-vip-note')).toBeVisible()
    await expect(page.getByTestId('customer-vip-make')).toHaveCount(0)
    const { error } = await dbAs('staff').rpc('set_customer_vip', { p_branch: fixtureIds().branchA, p_key: `p-${P1.key}`, p_vip: true })
    expect(error?.message).toBe('BAR_ONLY')
  })
})

test('P4-06-09 another branch: FORBIDDEN everywhere; customer_vips takes no direct write', async () => {
  const { branchA } = fixtureIds()
  for (const [fn, args] of [
    ['customer_list', { p_branch: branchA }],
    ['customer_detail', { p_branch: branchA, p_key: `p-${P1.key}` }],
    ['set_customer_vip', { p_branch: branchA, p_key: `p-${P1.key}`, p_vip: true }],
  ] as const) {
    const { error } = await dbAs('staffB').rpc(fn, args as never)
    expect(error?.message, fn).toBe('FORBIDDEN')
  }
  const { error } = await dbAs('bar').from('customer_vips').insert({ branch_id: branchA, phone_key: P1.key })
  expect(error, 'direct insert').not.toBeNull()
})

test.describe('bar', () => {
  test.use({ storageState: as('bar') })

  test('P4-06-10 a name-only customer: the button is off with a hint; the RPC answers NO_CUSTOMER_KEY', async ({ page }) => {
    const key = `n-${createHash('md5').update(NAME_ONLY.toLowerCase()).digest('hex')}`
    await page.goto(`/customers/${key}`)
    await expect(page.getByTestId('customer-vip-needs-key')).toBeVisible()
    await expect(page.getByTestId('customer-vip-make')).toHaveCount(0)
    const { error } = await dbAs('bar').rpc('set_customer_vip', { p_branch: fixtureIds().branchA, p_key: key, p_vip: true })
    expect(error?.message).toBe('NO_CUSTOMER_KEY')
  })

  test('P4-06-06 make VIP: every deposit in store, waiting or expired turns VIP (the expired one back in store); events and audit', async ({ page }) => {
    const started = new Date().toISOString()
    await page.goto(`/customers/p-${P1.key}`)
    await page.getByTestId('customer-vip-make').click()
    await expect(page.getByRole('dialog')).toContainText('3 รายการ')
    await page.getByTestId('customer-vip-submit').click()
    await expect(page.getByTestId('customer-vip')).toHaveAttribute('data-vip', 'on')
    await expect(page.getByTestId('customer-header').getByTestId('customer-vip-badge')).toBeVisible()

    for (const d of [depA1, depA2, depA3]) {
      const row = await deposit(d.id)
      expect(row, d.code).toMatchObject({ is_vip: true, expires_at: null, collect_deadline_at: null })
      expect(row.status, d.code).not.toBe('expired')
      const { data: ev } = await adminDb().from('deposit_events').select('payload').eq('deposit_id', d.id).eq('action', 'vip_on')
      expect(ev?.map((e) => e.payload), d.code).toEqual([{ customer: true }])
    }
    expect((await deposit(depA3.id)).status).toBe('in_store')
    const { data: audit } = await adminDb().from('audit_log').select('details').eq('branch_id', fixtureIds().branchA).eq('action', 'customer.vip_on').gte('at', started)
    expect(audit).toHaveLength(1)
    expect(audit![0].details).toMatchObject({ deposits_changed: 3 })

    await page.goto('/customers?filter=vip')
    await expect(page.getByTestId('customer-row').filter({ hasText: P1.dashed })).toHaveCount(1)
    await expect(page.getByTestId('customer-row').filter({ hasText: P1.dashed }).getByTestId('customer-vip-badge')).toBeVisible()
  })

  test('P4-06-07 later deposits of a VIP customer turn VIP by themselves — phone in any format, a LINE request received, a deposit linked later; not another branch', async () => {
    const byPhone = await takeDeposit({ name: 'สมชาย มาใหม่', phone: P1.intl })
    expect(await deposit(byPhone.id)).toMatchObject({ is_vip: true, expires_at: null, collect_deadline_at: null })
    const { data: ev } = await adminDb().from('deposit_events').select('actor_kind, payload').eq('deposit_id', byPhone.id).eq('action', 'vip_on')
    expect(ev).toEqual([{ actor_kind: 'system', payload: { auto: 'customer' } }])
    expect((await deposit(depB.id)).is_vip).toBe(false) // branch B's deposit with the same phone
    const newInB = await takeDeposit({ name: 'สาขาบี มาใหม่', phone: P1.key, branch: 'B', role: 'staffB' })
    expect((await deposit(newInB.id)).is_vip).toBe(false) // VIP is per branch

    const { branchA } = fixtureIds()
    const made = await dbAs('bar').rpc('set_customer_vip', { p_branch: branchA, p_key: `c-${c1.id}`, p_vip: true })
    expect(made.error, made.error?.message).toBeNull()
    expect(await deposit(depC2.id)).toMatchObject({ is_vip: true }) // the walk-in deposit with the LINE customer's phone

    const { data: req, error: reqError } = await adminDb().rpc('customer_request_deposit', {
      p_branch: branchA,
      p_customer_id: c1.id,
      p_customer_name: `${RUN} ขอฝากผ่าน LINE`,
      p_item_name: 'Hennessy VSOP',
      p_quantity: 1,
      p_terms_version: 'v1',
      p_terms_locale: 'th',
    })
    expect(reqError, reqError?.message).toBeNull()
    const requestId = (req as { id: string }).id
    expect((await deposit(requestId)).is_vip).toBe(false) // a request is not a deposit yet
    const received = await dbAs('staff').rpc('staff_receive_request', { p_deposit: requestId, p_quantity: 1, p_photo_paths: [await photo('A')] })
    expect(received.error, received.error?.message).toBeNull() // staff, past the bar-only guard
    expect(await deposit(requestId)).toMatchObject({ status: 'pending_confirm', is_vip: true, expires_at: null })

    const later = await takeDeposit({ name: 'เชื่อมทีหลัง', phone: P4.dashed })
    expect((await deposit(later.id)).is_vip).toBe(false)
    await link(later.id, c1.id)
    expect(await deposit(later.id)).toMatchObject({ is_vip: true, expires_at: null })

    // customer_vips shows only the reader's branches
    const { data: seenByB } = await dbAs('staffB').from('customer_vips').select('id').eq('branch_id', branchA)
    expect(seenByB).toEqual([])
    const { data: seenByA } = await dbAs('staff').from('customer_vips').select('id').eq('customer_id', c1.id)
    expect(seenByA).toHaveLength(1)
  })

  test('P4-06-08 cancel VIP: their VIP deposits count again from today; later deposits are not VIP; audit', async ({ page }) => {
    const started = new Date().toISOString()
    await page.goto(`/customers/p-${P1.key}`)
    await page.getByTestId('customer-vip-cancel').click()
    await expect(page.getByRole('dialog')).toContainText(`${depositDays} วัน`)
    await page.getByTestId('customer-vip-submit').click()
    await expect(page.getByTestId('customer-vip')).toHaveAttribute('data-vip', 'off')

    const soon = Date.now() + depositDays * 86_400_000
    for (const d of [depA1, depA2, depA3]) {
      const row = await deposit(d.id)
      expect(row.is_vip, d.code).toBe(false)
      expect(Math.abs(Date.parse(row.expires_at!) - soon), d.code).toBeLessThan(10 * 60_000)
      expect(row.collect_deadline_at, d.code).not.toBeNull()
    }
    const { data: vipRows } = await adminDb().from('customer_vips').select('id').eq('branch_id', fixtureIds().branchA).eq('phone_key', P1.key)
    expect(vipRows).toEqual([])
    const { data: audit } = await adminDb().from('audit_log').select('details').eq('branch_id', fixtureIds().branchA).eq('action', 'customer.vip_off').gte('at', started)
    expect(audit).toHaveLength(1)

    const after = await takeDeposit({ name: 'สมชาย หลังยกเลิก', phone: P1.key })
    expect((await deposit(after.id)).is_vip).toBe(false)
  })
})
