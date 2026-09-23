import { expect, test } from '@playwright/test'
import { CUSTOMER_KINDS, STAFF_KINDS, renderMessage } from '../../src/lib/line/render'
import type { FlexComponent, FlexMessage, LineMessage } from '../../src/lib/line/flex'
import { KEYWORD_KINDS, matchKeyword } from '../../src/lib/line/keywords'
import cxTh from '../../messages/customer/th.json'
import cxEn from '../../messages/customer/en.json'
import cxZh from '../../messages/customer/zh.json'
import cxKo from '../../messages/customer/ko.json'
import staffTh from '../../messages/staff/th.json'

/**
 * P3-A1 — the LINE renderer, imported directly (it is pure: catalogs + Intl, no env, no
 * 'server-only'). Runs no browser; global setup still runs but nothing here touches the DB.
 */

const CATALOG = { th: cxTh.line, en: cxEn.line, zh: cxZh.line, ko: cxKo.line }
const LOCALES = ['th', 'en', 'zh', 'ko'] as const
const DEPOSIT_ID = '7a0e8a52-2b1c-4c1e-9d55-0c3b1d0f6a11'
const LIFF = '1234567890-AbCdEfGh'

const PAYLOAD: Record<string, unknown> = {
  deposit_id: DEPOSIT_ID,
  booking_id: DEPOSIT_ID,
  code: 'DEP-ZAA-ABC23',
  item: 'Johnnie Walker Black Label',
  quantity: 3,
  remaining: 2,
  count: 1,
  expires_at: '2026-10-23T17:30:00Z',
  deadline: '2026-10-24T21:00:00Z',
  reason: 'bottle seal broken',
  night: '2026-10-24',
  time: '20:30',
  party: 4,
}
const BOOKING = { ...PAYLOAD, code: 'BK-1024-007' }

function flex(m: LineMessage | null): FlexMessage {
  expect(m, 'renderer returned null').not.toBeNull()
  expect(m!.type).toBe('flex')
  return m as FlexMessage
}

function texts(m: FlexMessage): string[] {
  const out: string[] = []
  const walk = (c: FlexComponent) => {
    if (c.type === 'text') out.push(c.text)
    else if (c.type === 'box') c.contents.forEach(walk)
  }
  for (const box of [m.contents.header, m.contents.body, m.contents.footer]) if (box) walk(box)
  return out
}

/** every uri button in the footer, in order */
function buttons(m: FlexMessage) {
  return (m.contents.footer?.contents ?? []).flatMap((c) => (c.type === 'button' ? [c.action] : []))
}

/** a template placeholder the renderer failed to fill: {word} */
const UNFILLED = /\{[A-Za-z_]+\}/

test('P3-A1-01 every customer kind × th/en/zh/ko renders a catalog-worded flex bubble', () => {
  const titleKey: Record<string, keyof typeof cxTh.line.titles> = {
    deposit_confirmed: 'depositConfirmed',
    deposit_rejected: 'depositRejected',
    withdraw_completed: 'withdrawCompleted',
    withdraw_rejected: 'withdrawRejected',
    expiry_soon: 'expirySoon',
    expired: 'expired',
    disposed: 'disposed',
    booking_confirmed: 'bookingConfirmed',
    booking_pending: 'bookingPending',
    booking_rejected: 'bookingRejected',
    booking_cancelled: 'bookingCancelled',
    booking_reminder: 'bookingReminder',
  }
  let rendered = 0
  for (const kind of CUSTOMER_KINDS) {
    for (const loc of LOCALES) {
      const m = flex(renderMessage(kind, loc, kind.startsWith('booking') ? BOOKING : PAYLOAD, { liffId: LIFF }))
      expect(m.contents.type).toBe('bubble')
      expect(m.altText.length).toBeGreaterThan(0)
      expect(m.altText.length).toBeLessThanOrEqual(400)
      const all = texts(m)
      expect(all, `${kind}/${loc} title`).toContain(CATALOG[loc].titles[titleKey[kind]])
      const json = JSON.stringify(m)
      expect(json, `${kind}/${loc}`).not.toMatch(UNFILLED)
      expect(json, `${kind}/${loc} raw key`).not.toMatch(/"line\.|titles\./)
      // the payload reaches the sentence: the item for deposit kinds, the booking code for bookings
      expect(all.join(' '), `${kind}/${loc}`).toContain(kind.startsWith('booking') ? 'BK-1024-007' : 'Johnnie Walker')
      rendered++
    }
  }
  expect(rendered).toBe(CUSTOMER_KINDS.length * 4)
  // the button opens the branch LIFF app (bottles) or the ticket page (bookings)
  const conf = flex(renderMessage('deposit_confirmed', 'en', PAYLOAD, { liffId: LIFF }))
  expect(conf.contents.footer?.contents[0]).toMatchObject({ type: 'button', action: { type: 'uri', uri: `https://liff.line.me/${LIFF}`, label: cxEn.line.viewBottles } })
  const ticket = flex(renderMessage('booking_confirmed', 'zh', BOOKING, { liffId: LIFF }))
  expect(ticket.contents.footer?.contents[0]).toMatchObject({ action: { uri: `https://liff.line.me/${LIFF}/ticket/BK-1024-007`, label: cxZh.line.viewTicket } })
  // no LIFF id → no button
  expect(flex(renderMessage('deposit_confirmed', 'th', PAYLOAD, {})).contents.footer).toBeUndefined()
  // unknown kind / bad locale never throw
  expect(renderMessage('no_such_kind', 'th', PAYLOAD)).toBeNull()
  expect(texts(flex(renderMessage('expired', 'xx', PAYLOAD)))).toContain(cxTh.line.titles.expired)
  expect(cxKo.line.titles.expired).toBeTruthy()
})

test('P3-A1-02 staff-group kinds are Thai; the deep-link button exists only with APP_BASE_URL', () => {
  const s = staffTh.settingsLine.messages
  const payloads: Record<(typeof STAFF_KINDS)[number], Record<string, unknown>> = {
    deposit_requested: { deposit_id: DEPOSIT_ID, code: 'DEP-ZAA-ABC23', customer: 'คุณเอ', item: 'Hennessy VSOP', count: 2, table: 'A3' },
    withdrawal_requested: { deposit_id: DEPOSIT_ID, code: 'DEP-ZAA-ABC23', customer: 'คุณเอ', item: 'Hennessy VSOP', count: 1, table: 'B1', type: 'in_store' },
    booking_new: { booking_id: DEPOSIT_ID, code: 'BK-1024-007', name: 'คุณบี', party: 6, night: '2026-10-24', time: '21:00' },
    test: { at: '2026-10-23T13:05:00Z' },
  }
  const expectedPath: Record<string, string | null> = {
    deposit_requested: `/deposits/${DEPOSIT_ID}`,
    withdrawal_requested: `/deposits/${DEPOSIT_ID}`,
    booking_new: '/bookings?night=2026-10-24',
    test: null,
  }
  const titles: Record<string, string> = {
    deposit_requested: s.depositRequestedTitle.replace('{code}', 'DEP-ZAA-ABC23'),
    withdrawal_requested: s.withdrawalRequestedTitle.replace('{code}', 'DEP-ZAA-ABC23'),
    booking_new: s.bookingNewTitle.replace('{code}', 'BK-1024-007'),
    test: s.testTitle,
  }
  for (const kind of STAFF_KINDS) {
    // even a customer-locale row renders Thai for the staff group
    const withBase = flex(renderMessage(kind, 'en', payloads[kind], { appBaseUrl: 'https://sis.example.com/' }))
    expect(texts(withBase)).toContain(titles[kind])
    expect(withBase.altText.length).toBeLessThanOrEqual(400)
    expect(JSON.stringify(withBase)).not.toMatch(UNFILLED)
    const button = withBase.contents.footer?.contents[0]
    if (expectedPath[kind]) {
      expect(button).toMatchObject({ type: 'button', action: { type: 'uri', uri: `https://sis.example.com${expectedPath[kind]}`, label: s.open } })
    } else {
      expect(withBase.contents.footer).toBeUndefined()
    }
    const without = flex(renderMessage(kind, 'th', payloads[kind], { appBaseUrl: null }))
    expect(without.contents.footer, `${kind} without APP_BASE_URL`).toBeUndefined()
  }
  expect(texts(flex(renderMessage('withdrawal_requested', 'th', payloads.withdrawal_requested, {})))).toContain(s.inStore)
  // a deposit id that is not a uuid never becomes a link
  const odd = flex(renderMessage('deposit_requested', 'th', { ...payloads.deposit_requested, deposit_id: '../../settings' }, { appBaseUrl: 'https://sis.example.com' }))
  expect(odd.contents.footer).toBeUndefined()
})

test('P3-A1-03 dates are Bangkok time; พ.ศ. for th, ค.ศ. for en/zh/ko', () => {
  // 17:30 UTC on 23 Oct = 00:30 on 24 Oct in Bangkok
  const expected = { th: '24 ต.ค. 2569', en: '24 Oct 2026', zh: '2026年10月24日', ko: '2026년 10월 24일' }
  for (const loc of LOCALES) {
    const m = flex(renderMessage('deposit_confirmed', loc, PAYLOAD, {}))
    const body = texts(m).join(' ')
    expect(body, loc).toContain(expected[loc])
    expect(body, loc).not.toMatch(loc === 'th' ? /2026/ : /2569/)
  }
  // deadline carries the Bangkok wall-clock time (21:00Z → 04:00 next day)
  const soon = flex(renderMessage('expiry_soon', 'en', PAYLOAD, {}))
  expect(texts(soon).join(' ')).toContain('25 Oct 2026 04:00')
  // a business night stays that calendar day
  const booking = flex(renderMessage('booking_confirmed', 'th', BOOKING, {}))
  expect(texts(booking).join(' ')).toContain('24 ต.ค. 2569')
  // staff group: the test message time is Bangkok (13:05Z → 20:05)
  const t = flex(renderMessage('test', 'th', { at: '2026-10-23T13:05:00Z' }, {}))
  expect(texts(t).join(' ')).toContain('20:05')
  expect(texts(t).join(' ')).toContain('2569')
})

test('P3-A1-04 long / odd payload text is capped and never re-expanded', () => {
  const longName = `${'ก'.repeat(150)}😀${'x'.repeat(49)}` // 200 code points incl. an emoji
  const nasty = { deposit_id: DEPOSIT_ID, code: '{code}', customer: longName, item: `{item} ${'🍾'.repeat(300)}`, count: '{count}', table: 'A'.repeat(500) }
  const m = flex(renderMessage('deposit_requested', 'th', nasty, { appBaseUrl: 'https://sis.example.com' }))
  expect(m.altText.length).toBeLessThanOrEqual(400)
  const all = texts(m)
  for (const t of all) expect(Array.from(t).length).toBeLessThanOrEqual(1000)
  // the values are text: "{code}" / "{item}" stay literal, count that is not a number is dropped
  expect(all.join(' ')).toContain('{code}')
  expect(all.join(' ')).toContain('{item}')
  expect(all.join(' ')).not.toContain('NaN')
  // names cut at 60 code points, an emoji never split into a lone surrogate
  expect(JSON.stringify(m)).not.toMatch(/\\ud83[cd](?!\\ud[c-f])/i)
  const body = all.find((t) => t.startsWith('ก'))!
  expect(Array.from(body.split(' · ')[0]).length).toBeLessThanOrEqual(60)
  // customer side: a 200-char reason, null payload, array payload all still render
  const r = flex(renderMessage('deposit_rejected', 'ko', { item: 'x', reason: 'r'.repeat(500) }, {}))
  expect(r.altText.length).toBeLessThanOrEqual(400)
  expect(flex(renderMessage('disposed', 'en', null, {})).contents.type).toBe('bubble')
  expect(flex(renderMessage('disposed', 'en', ['x'], {})).contents.type).toBe('bubble')
  // no reason → the catalog fallback, not an empty sentence
  expect(texts(flex(renderMessage('withdraw_rejected', 'en', { item: 'x' }, {}))).join(' ')).toContain(cxEn.line.noReason)
  // a round-trip through JSON (what goes on the wire) is lossless
  expect(JSON.parse(JSON.stringify(m))).toEqual(m)
})

test('P3-A1-05 chat keywords (ฝาก / เบิก / จองโต๊ะ / เมนู …) match in every language, whole message only', () => {
  const cases: [string, string | null][] = [
    ['ฝาก', 'kw_deposit'], ['ฝากเหล้า', 'kw_deposit'], [' ฝาก เหล้า ', 'kw_deposit'], ['Deposit', 'kw_deposit'], ['寄存', 'kw_deposit'],
    ['เบิก', 'kw_withdraw'], ['เบิกเหล้า', 'kw_withdraw'], ['เบิกเหล้าครับ', 'kw_withdraw'], ['withdraw', 'kw_withdraw'],
    ['ขวดของฉัน', 'kw_bottles'], ['เหล้าของฉัน', 'kw_bottles'], ['My Bottles', 'kw_bottles'],
    ['จอง', 'kw_book'], ['จองโต๊ะ', 'kw_book'], ['จองโต๊ะค่ะ', 'kw_book'], ['BOOK!', 'kw_book'], ['예약', 'kw_book'], ['预约', 'kw_book'],
    ['ตั๋วจอง', 'kw_tickets'], ['my booking', 'kw_tickets'],
    ['เมนู', 'kw_menu'], ['help', 'kw_menu'],
    ['อยากจองโต๊ะพรุ่งนี้', null], ['สวัสดี', null], ['K7M2QX', null], ['DEP-SRC-ABC23', null], ['', null],
  ]
  for (const [typed, kind] of cases) expect(matchKeyword(typed), JSON.stringify(typed)).toBe(kind)
})

test('P3-A1-06 every reply is a flex bubble; keyword cards open the matching LIFF page in 4 languages', () => {
  const page: Record<(typeof KEYWORD_KINDS)[number], string> = {
    kw_deposit: '/deposit',
    kw_withdraw: '',
    kw_bottles: '',
    kw_book: '/book',
    kw_tickets: '/tickets',
    kw_menu: '',
  }
  for (const kind of KEYWORD_KINDS) {
    for (const loc of LOCALES) {
      const m = flex(renderMessage(kind, loc, {}, { liffId: LIFF }))
      expect(JSON.stringify(m), `${kind}/${loc}`).not.toMatch(UNFILLED)
      expect(m.altText.length).toBeGreaterThan(0)
      const [first] = buttons(m)
      expect(first, `${kind}/${loc}`).toMatchObject({ type: 'uri', uri: `https://liff.line.me/${LIFF}${page[kind]}` })
      expect(texts(m).join(' ')).toContain(CATALOG[loc].hint)
    }
  }
  // the menu card offers every page
  const menu = buttons(flex(renderMessage('kw_menu', 'th', {}, { liffId: LIFF }))).map((a) => a.uri)
  for (const path of ['', '/deposit', '/book', '/tickets']) expect(menu).toContain(`https://liff.line.me/${LIFF}${path}`)
  // no LIFF app yet: no buttons, and the card says to ask the staff
  const bare = flex(renderMessage('kw_book', 'en', {}, {}))
  expect(buttons(bare)).toHaveLength(0)
  expect(texts(bare)).toContain(cxEn.line.kwNoApp)

  // the former plain-text replies are bubbles too
  for (const kind of ['link_not_found', 'use_receipt_code', 'throttled', 'welcome', 'linked'] as const) {
    for (const loc of LOCALES) expect(flex(renderMessage(kind, loc, PAYLOAD, { liffId: LIFF })).contents.type).toBe('bubble')
  }
  expect(texts(flex(renderMessage('throttled', 'th', {}, {})))).toContain(cxTh.line.throttled)
  const bound = flex(renderMessage('group_bound', 'th', {}, { branchName: 'ศรีราชา' }))
  expect(texts(bound)).toContain(staffTh.settingsLine.messages.groupBoundTitle)
  expect(texts(bound).join(' ')).toContain('ศรีราชา')

  // logo in the header only over https
  expect(JSON.stringify(flex(renderMessage('kw_menu', 'th', {}, { appBaseUrl: 'https://sis.example.com' })))).toContain('https://sis.example.com/apple-touch-icon.png')
  expect(JSON.stringify(flex(renderMessage('kw_menu', 'th', {}, { appBaseUrl: 'http://localhost:3000' })))).not.toContain('apple-touch-icon')

  // the header names the branch only (its name already carries the shop's); the shop name when unknown
  const headerTexts = (m: FlexMessage) => {
    const out: string[] = []
    const walk = (c: FlexComponent) => (c.type === 'text' ? out.push(c.text) : c.type === 'box' ? c.contents.forEach(walk) : undefined)
    walk(m.contents.header)
    return out
  }
  expect(headerTexts(flex(renderMessage('kw_book', 'th', {}, { branchName: 'SIS Music Bar ศรีราชา' })))[0]).toBe('SIS Music Bar ศรีราชา')
  expect(headerTexts(flex(renderMessage('deposit_confirmed', 'en', PAYLOAD, { branchName: 'SIS Music Bar ศรีราชา' })))[0]).toBe('SIS Music Bar ศรีราชา')
  expect(headerTexts(flex(renderMessage('kw_book', 'th', {}, {})))[0]).toBe('SIS Music Bar')
})
