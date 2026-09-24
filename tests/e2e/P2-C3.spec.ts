import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
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
  await admin.from('booking_settings').update({ closed_weekdays: originalClosedWeekdays ?? [] }).eq('branch_id', branchA)
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
