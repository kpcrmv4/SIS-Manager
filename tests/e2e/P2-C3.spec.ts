import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { BASE_URL } from './fixtures/env'
import { BRANCH_A_CODE } from './fixtures/users'
import { cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import { signCustomerToken } from './fixtures/p2c-token'
import { addDays, businessNight, weekdayIndex } from '../../src/lib/date'

test.describe.configure({ mode: 'serial' })

const codeLower = BRANCH_A_CODE.toLowerCase()
const RUN = `E2EC3-${Date.now().toString(36)}`
const zoneIds: string[] = []
let originalClosedWeekdays: number[] | null = null

test.afterAll(async () => {
  const admin = adminDb()
  const { branchA } = fixtureIds()
  if (zoneIds.length) await admin.from('table_zones').delete().in('id', zoneIds)
  await admin.from('booking_settings').update({ closed_weekdays: originalClosedWeekdays ?? [], table_choice: 'shop' }).eq('branch_id', branchA)
  await admin.from('bookings').delete().like('name', `${RUN}%`)
  await cleanupRun()
  await cleanupCustomers()
})

async function withCustomerDouble(page: Page, token: string) {
  await page.addInitScript((t) => {
    ;(window as unknown as { __SIS_LIFF_TEST__?: { customerToken: string } }).__SIS_LIFF_TEST__ = { customerToken: t }
  }, token)
}

async function addBookableZone(branchId: string, name: string, bookable: boolean) {
  const { data, error } = await adminDb().from('table_zones').insert({ branch_id: branchId, name, customer_bookable: bookable, sort: 50 }).select('id').single()
  expect(error, error?.message).toBeNull()
  zoneIds.push(data!.id)
  return data!.id
}

const ZXING_UMD = join(process.cwd(), 'node_modules', '@zxing', 'browser', 'umd', 'zxing-browser.min.js')

/** Decodes the rendered <img data-testid="cx-ticket-qr"> with a real QR reader (not a byte compare — the
 * `qrcode` package renders slightly different PNG bytes in Node vs. the browser for identical content). */
async function decodeTicketQr(page: Page): Promise<string> {
  await page.addScriptTag({ path: ZXING_UMD })
  return page.evaluate(async () => {
    const ZXingBrowser = (window as unknown as { ZXingBrowser: { BrowserQRCodeReader: new () => { decodeFromImageElement(el: HTMLImageElement): Promise<{ getText(): string }> } } }).ZXingBrowser
    const reader = new ZXingBrowser.BrowserQRCodeReader()
    const img = document.querySelector('[data-testid="cx-ticket-qr"]') as HTMLImageElement
    const result = await reader.decodeFromImageElement(img)
    return result.getText()
  })
}

test('P2-C3-01 book: a closed weekday is struck through, slots/party/zone work, and booking creates a ticket', async ({ page }) => {
  const { branchA } = fixtureIds()
  const { data: settings } = await adminDb().from('booking_settings').select('closed_weekdays').eq('branch_id', branchA).single()
  originalClosedWeekdays = settings?.closed_weekdays ?? []

  const bookNight = addDays(businessNight(), 3)
  const closedNight = addDays(businessNight(), 1)
  const closedDow = weekdayIndex(closedNight)
  await adminDb().from('booking_settings').update({ closed_weekdays: [closedDow] }).eq('branch_id', branchA)

  const bookableZone = await addBookableZone(branchA, `${RUN} หน้าเวที`, true)
  await addBookableZone(branchA, `${RUN} VIP`, false)

  const me = await makeCustomer()
  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}/book`)

  const closedBtn = page.getByTestId(`cx-date-${closedNight}`)
  await expect(closedBtn).toBeDisabled()

  await page.getByTestId(`cx-date-${bookNight}`).click()
  await expect(page.getByTestId(`cx-zone-${bookableZone}`)).toBeVisible()

  const slotBtn = page.locator('.cx-slots button').first()
  await slotBtn.click()

  // the party stepper never goes below the branch's party_min (default 1)
  const minus = page.locator('.cx-stepper button[aria-label="-"]')
  for (let i = 0; i < 3; i++) await minus.click()
  await expect(page.locator('.cx-stepper b')).toHaveText('1 คน')

  await page.getByTestId(`cx-zone-${bookableZone}`).click()
  await page.getByTestId('cx-book-name').fill(`${RUN} คุณทดสอบ`)
  await page.getByTestId('cx-book-submit').click()

  await page.waitForURL(new RegExp(`/liff/${codeLower}/ticket/BK-`))
  const code = page.url().split('/ticket/')[1]
  const { data: row } = await adminDb().from('bookings').select('night, party_size, zone_id, customer_id, status').eq('code', code).eq('branch_id', branchA).single()
  expect(row).toMatchObject({ night: bookNight, zone_id: bookableZone, customer_id: me.id })
  expect(['pending', 'confirmed']).toContain(row?.status)

  // restore now (not in afterAll) — later tests in this file also book against branchA
  await adminDb().from('booking_settings').update({ closed_weekdays: originalClosedWeekdays ?? [] }).eq('branch_id', branchA)
})

test('P2-C3-02 the ticket QR encodes qr_token, not the booking code', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const night = addDays(businessNight(), 4)

  // auto_confirm so this booking is 'confirmed' immediately — a QR only renders for a
  // confirmed/arrived booking (a pending one shows ticket.pendingQr instead, per P2-C2/C3 spec)
  const admin = adminDb()
  const { data: before } = await admin.from('booking_settings').select('auto_confirm').eq('branch_id', branchA).single()
  await admin.from('booking_settings').update({ auto_confirm: true }).eq('branch_id', branchA)
  let code = ''
  try {
    const { data: created, error } = await admin.rpc('create_booking', {
      p_branch: branchA,
      p_night: night,
      p_slot: '20:00:00',
      p_party: 2,
      p_name: `${RUN} confirmed`,
      p_customer_id: me.id,
    } as never)
    expect(error, error?.message).toBeNull()
    code = (created as { code: string }).code
  } finally {
    await admin.from('booking_settings').update({ auto_confirm: before?.auto_confirm ?? false }).eq('branch_id', branchA)
  }

  const { data: row } = await adminDb().from('bookings').select('qr_token, status').eq('code', code).eq('branch_id', branchA).single()
  expect(row?.status).toBe('confirmed')

  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}/ticket/${code}`)

  const img = page.getByTestId('cx-ticket-qr')
  await expect(img).toBeVisible()
  await expect(img).toHaveAttribute('src', /^data:image\/png;base64,/)
  const decoded = await decodeTicketQr(page)
  expect(decoded).toBe(row!.qr_token)
  expect(decoded).not.toBe(code)
  expect(decoded).toMatch(/^[0-9a-f]{32}$/)
})

test('P2-C3-03 cancel works inside the window and is disabled outside it', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const soon = addDays(businessNight(), 5)

  const { data: soonBooking, error: e1 } = await adminDb().rpc('create_booking', {
    p_branch: branchA,
    p_night: soon,
    p_slot: '21:00:00',
    p_party: 2,
    p_name: `${RUN} soon`,
    p_customer_id: me.id,
  } as never)
  expect(e1, e1?.message).toBeNull()
  const soonCode = (soonBooking as { code: string }).code

  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}/ticket/${soonCode}`)
  await expect(page.getByTestId('cx-ticket-cancel')).toBeEnabled()
  await page.getByTestId('cx-ticket-cancel').click()
  // the confirm dialog fits its two buttons — it once inherited the page root's 100dvh (R-035)
  const dialog = page.getByTestId('cx-ticket-cancel-dialog')
  await expect(dialog).toBeVisible()
  expect((await dialog.boundingBox())!.height).toBeLessThan(240)
  await page.getByTestId('cx-ticket-cancel-confirm').click()
  await expect(page.getByText('ยกเลิกการจองแล้ว')).toBeVisible()
  const { data: cancelled } = await adminDb().from('bookings').select('status, cancelled_by_customer').eq('code', soonCode).eq('branch_id', branchA).single()
  expect(cancelled).toMatchObject({ status: 'cancelled', cancelled_by_customer: true })

  // a booking whose night is already in the past is always outside the cancel window
  const { data: pastBooking, error: e2 } = await adminDb().rpc('create_booking', {
    p_branch: branchA,
    p_night: addDays(businessNight(), 6),
    p_slot: '21:00:00',
    p_party: 2,
    p_name: `${RUN} past`,
    p_customer_id: me.id,
  } as never)
  expect(e2, e2?.message).toBeNull()
  const pastCode = (pastBooking as { code: string }).code
  await adminDb().from('bookings').update({ night: addDays(businessNight(), -1) }).eq('code', pastCode).eq('branch_id', branchA)

  await page.goto(`/liff/${codeLower}/ticket/${pastCode}`)
  await expect(page.getByTestId('cx-ticket-cancel')).toBeDisabled()
  await expect(page.getByText('เลยเวลายกเลิกเองแล้ว')).toBeVisible()
})

test('P2-C3-04 the book form shows how many in-store deposits this customer has', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const d1 = await mustCreate('staff', { qty: 1, customerId: me.id })
  await confirmAll(d1.id, [100])
  const d2 = await mustCreate('staff', { qty: 1, customerId: me.id })
  await confirmAll(d2.id, [100])

  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}/book`)
  await page.locator('.cx-dates button:not(:disabled)').first().click()

  const hint = page.getByTestId('cx-has-deposits')
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('2')
})

test('P2-C3-05 the my-bookings list shows upcoming and past bookings, each linking to its ticket', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const { data: future, error: e1 } = await adminDb().rpc('create_booking', {
    p_branch: branchA,
    p_night: addDays(businessNight(), 7),
    p_slot: '19:30:00',
    p_party: 2,
    p_name: `${RUN} future`,
    p_customer_id: me.id,
  } as never)
  expect(e1, e1?.message).toBeNull()
  const { data: pastRaw, error: e2 } = await adminDb().rpc('create_booking', {
    p_branch: branchA,
    p_night: addDays(businessNight(), 8),
    p_slot: '19:30:00',
    p_party: 2,
    p_name: `${RUN} past-list`,
    p_customer_id: me.id,
  } as never)
  expect(e2, e2?.message).toBeNull()
  const pastCode = (pastRaw as { code: string }).code
  await adminDb().from('bookings').update({ night: addDays(businessNight(), -2) }).eq('code', pastCode).eq('branch_id', branchA)

  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}/tickets`)

  const rows = page.getByTestId('cx-booking-row')
  await expect(rows).toHaveCount(2)
  const futureCode = (future as { code: string }).code
  await page.locator(`[data-code="${futureCode}"]`).click()
  await page.waitForURL(`**/liff/${codeLower}/ticket/${futureCode}`)
})

test('P2-C3-06 a booking code belonging to another customer 404s', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const other = await makeCustomer()
  const { data: theirs, error } = await adminDb().rpc('create_booking', {
    p_branch: branchA,
    p_night: addDays(businessNight(), 9),
    p_slot: '19:30:00',
    p_party: 2,
    p_name: `${RUN} theirs`,
    p_customer_id: other.id,
  } as never)
  expect(error, error?.message).toBeNull()

  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}/ticket/${(theirs as { code: string }).code}`)
  await expect(page.getByText('ไม่พบรายการจองนี้')).toBeVisible()
})

type T = { id: string; label: string }
/**
 * Guests pick their table (R-036) at branch A, with one zone of four tables for `night`: free,
 * held by a staff booking that night, switched off for customers, and a 6–10 seater.
 */
async function planFixture(night: string, prefix: string) {
  const { branchA } = fixtureIds()
  await adminDb().from('booking_settings').update({ table_choice: 'customer', closed_weekdays: [] }).eq('branch_id', branchA)
  const sfx = RUN.slice(-3)
  const zone = await addBookableZone(branchA, `${RUN} ${prefix} เลือกโต๊ะ`, true)
  const add = async (label: string, min: number, max: number, extra: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await adminDb()
      .from('tables')
      .insert({ branch_id: branchA, zone_id: zone, label: `${prefix}${label}${sfx}`, seats_min: min, seats_max: max, ...extra })
      .select('id, label')
      .single()
    expect(error, error?.message).toBeNull()
    return data!
  }
  const free = await add('F', 1, 4)
  const taken = await add('K', 1, 4)
  const closed = await add('X', 1, 4, { customer_bookable: false })
  const big = await add('B', 6, 10)
  const held = await dbAs('staff').rpc('create_booking', { p_branch: branchA, p_night: night, p_slot: '21:00:00', p_party: 2, p_name: `${RUN} ถือโต๊ะ`, p_table: taken.id } as never)
  expect(held.error, held.error?.message).toBeNull()
  return { zone, free, taken, closed, big }
}

const tile = (page: Page, label: string) => page.locator(`[data-testid="cx-table"][data-label="${label}"]`)

test('P2-C3-07 guests pick their table: free / taken / blocked / too small on the plan, the picked table is booked', async ({ page }) => {
  const { branchA } = fixtureIds()
  const night = addDays(businessNight(), 2)
  const t = await planFixture(night, 'P')
  const me = await makeCustomer()
  await withCustomerDouble(page, signCustomerToken(me.id, branchA))
  await page.goto(`/liff/${codeLower}/book`)
  await page.getByTestId(`cx-date-${night}`).click()

  await expect(tile(page, t.free.label)).toHaveAttribute('data-state', 'free')
  await expect(tile(page, t.taken.label)).toHaveAttribute('data-state', 'taken')
  await expect(tile(page, t.closed.label)).toHaveAttribute('data-state', 'blocked')
  await expect(tile(page, t.big.label)).toHaveAttribute('data-state', 'small') // a party of 2 at a 6–10 table
  for (const x of [t.taken, t.closed, t.big]) await expect(tile(page, x.label)).toBeDisabled()
  // the screen agrees with the database
  const plan = (await adminDb().rpc('table_availability', { p_branch: branchA, p_night: night })).data as unknown as { zones: { tables: { id: string; state: string }[] }[] }
  const db = Object.fromEntries(plan.zones.flatMap((z) => z.tables).map((x) => [x.id, x.state]))
  expect([db[t.free.id], db[t.taken.id], db[t.closed.id], db[t.big.id]]).toEqual(['free', 'taken', 'blocked', 'free'])

  await page.locator('.cx-slots button').first().click()
  await expect(page.getByTestId('cx-book-submit')).toBeDisabled() // no table picked yet
  await tile(page, t.free.label).click()
  await expect(tile(page, t.free.label)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('cx-table-picked')).toContainText(t.free.label)
  await page.getByTestId('cx-book-name').fill(`${RUN} เลือกเอง`)
  await page.getByTestId('cx-book-submit').click()

  await page.waitForURL(new RegExp(`/liff/${codeLower}/ticket/BK-`))
  const code = page.url().split('/ticket/')[1]
  const { data: row } = await adminDb().from('bookings').select('table_id, zone_id, night').eq('code', code).eq('branch_id', branchA).single()
  expect(row).toEqual({ table_id: t.free.id, zone_id: t.zone, night })
  await expect(page.getByTestId('cx-ticket')).toContainText(t.free.label)
})

test('P2-C3-08 when the shop seats guests: zone chips and no plan; the tables API answers 403', async ({ page, request }) => {
  const { branchA } = fixtureIds()
  await adminDb().from('booking_settings').update({ table_choice: 'shop' }).eq('branch_id', branchA)
  const me = await makeCustomer()
  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}/book`)
  await expect(page.getByTestId('cx-zone-any')).toBeVisible()
  await expect(page.getByTestId('cx-table-section')).toHaveCount(0)
  const res = await request.get(`${BASE_URL}/api/customer/tables?branch=${codeLower}&night=${addDays(businessNight(), 2)}`, { headers: { 'X-Customer-Token': token } })
  expect(res.status()).toBe(403)
  expect(await res.json()).toEqual({ error: 'table_choice_off' })
})

test('P2-C3-09 the picked table is taken before sending: a toast, the plan shows it taken, nothing booked', async ({ page }) => {
  const { branchA } = fixtureIds()
  const night = addDays(businessNight(), 2)
  const t = await planFixture(night, 'R')
  const me = await makeCustomer()
  await withCustomerDouble(page, signCustomerToken(me.id, branchA))
  await page.goto(`/liff/${codeLower}/book`)
  await page.getByTestId(`cx-date-${night}`).click()
  await page.locator('.cx-slots button').first().click()
  await tile(page, t.free.label).click()
  await page.getByTestId('cx-book-name').fill(`${RUN} ช้าไป`)

  // someone else takes it first
  const other = await dbAs('staff').rpc('create_booking', { p_branch: branchA, p_night: night, p_slot: '22:00:00', p_party: 2, p_name: `${RUN} คนอื่น`, p_table: t.free.id } as never)
  expect(other.error, other.error?.message).toBeNull()
  await page.getByTestId('cx-book-submit').click()

  await expect(page.getByText('โต๊ะนี้เพิ่งถูกจองไป เลือกโต๊ะอื่นได้เลย')).toBeVisible()
  await expect(tile(page, t.free.label)).toHaveAttribute('data-state', 'taken')
  await expect(page.getByTestId('cx-table-picked')).toHaveCount(0)
  expect((await adminDb().from('bookings').select('id').eq('name', `${RUN} ช้าไป`)).data).toHaveLength(0)
})

test('P2-C3-10 each card on my bookings says where it stands: waiting, confirmed with its table, cancelled', async ({ page }) => {
  const { branchA } = fixtureIds()
  const admin = adminDb()
  // the shop seats guests here (an earlier test left the plan on), every weekday open
  await admin.from('booking_settings').update({ table_choice: 'shop', closed_weekdays: [] }).eq('branch_id', branchA)
  const zone = await addBookableZone(branchA, `${RUN} สถานะ`, true)
  const label = `ST${RUN.slice(-3)}`
  const table = (await admin.from('tables').insert({ branch_id: branchA, zone_id: zone, label, seats_min: 1, seats_max: 4 }).select('id').single()).data!
  const me = await makeCustomer()
  const book = async (days: number, status: 'pending' | 'confirmed' | 'cancelled', extra: { zone_id?: string; table_id?: string } = {}) => {
    const { data, error } = await admin.rpc('create_booking', {
      p_branch: branchA,
      p_night: addDays(businessNight(), days),
      p_slot: '21:00:00',
      p_party: 3,
      p_name: `${RUN} ${status}`,
      p_customer_id: me.id,
    } as never)
    expect(error, error?.message).toBeNull()
    const b = data as { id: string; code: string }
    const up = await admin.from('bookings').update({ status, ...extra }).eq('id', b.id)
    expect(up.error, up.error?.message).toBeNull()
    return b.code
  }
  const waiting = await book(9, 'pending')
  const confirmed = await book(10, 'confirmed', { zone_id: zone, table_id: table.id })
  const cancelled = await book(11, 'cancelled')

  await withCustomerDouble(page, signCustomerToken(me.id, branchA))
  await page.goto(`/liff/${codeLower}/tickets`)
  const row = (code: string) => page.locator(`[data-testid="cx-booking-row"][data-code="${code}"]`)
  const pill = (code: string) => row(code).getByTestId('cx-booking-status')
  await expect(pill(waiting)).toHaveText('รอร้านยืนยัน')
  await expect(pill(waiting)).toHaveClass(/\bwarn\b/)
  await expect(pill(confirmed)).toHaveText('ยืนยันแล้ว')
  await expect(row(confirmed)).toContainText(`โต๊ะ ${label}`)
  await expect(pill(cancelled)).toHaveText('ยกเลิกแล้ว')
  await expect(pill(cancelled)).toHaveClass(/\bdanger\b/)
  // readable without opening it, and it still opens
  await row(waiting).click()
  await page.waitForURL(`**/liff/${codeLower}/ticket/${waiting}`)
})
