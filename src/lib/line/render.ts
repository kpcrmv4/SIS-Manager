import { SHOP_NAME } from '../constants'
import { customerLine, isLineLocale, staffLine, type CustomerLine, type LineLocale } from './catalog'
import { TEMPLATE_MAX, fillExpiryTemplate } from './expiry-template'
import { bubble, type BubbleButton, type LineMessage } from './flex'
import { KEYWORD_KINDS } from './keywords'
import { clip, daysUntilBangkok, int, interpolate, lineDate, lineDateTime, lineTime, slotTime } from './format'

export type { LineMessage } from './flex'

/**
 * One renderer for every outbox kind the database enqueues (private.notify_customer /
 * notify_staff_group / notify_booking / send_line_test) and every webhook reply.
 * Returns null for a kind it does not know — the dispatcher marks that row `skipped`;
 * nothing here ever throws on a bad payload.
 */

export const CUSTOMER_KINDS = [
  'deposit_confirmed',
  'deposit_rejected',
  'withdraw_completed',
  'withdraw_rejected',
  'expiry_soon',
  'expired',
  'disposed',
  'booking_confirmed',
  'booking_pending',
  'booking_rejected',
  'booking_cancelled',
  'booking_reminder',
] as const
export const STAFF_KINDS = ['deposit_requested', 'withdrawal_requested', 'booking_new', 'test'] as const
export const REPLY_KINDS = ['linked', 'welcome', 'link_not_found', 'use_receipt_code', 'throttled', 'group_bound', ...KEYWORD_KINDS] as const
export type LineKind = (typeof CUSTOMER_KINDS)[number] | (typeof STAFF_KINDS)[number] | (typeof REPLY_KINDS)[number]

export type RenderContext = {
  /** the branch's LIFF id — customer messages get an "open the app" button when set */
  liffId?: string | null
  /** APP_BASE_URL — staff-group messages get a deep-link button, and every bubble the logo, when set */
  appBaseUrl?: string | null
  branchName?: string | null
}

type Payload = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function liffUrl(liffId: string | null | undefined, path = ''): string | null {
  if (!liffId || !/^\d{4,20}-[A-Za-z0-9]{4,32}$/.test(liffId)) return null
  return `https://liff.line.me/${liffId}${path}`
}

function appUrl(base: string | null | undefined, path: string): string | null {
  if (!base) return null
  try {
    const u = new URL(base)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}${path}`
  } catch {
    return null
  }
}

/** The shop logo for the bubble header — LINE only loads https images. */
function logoUrl(ctx: RenderContext): string | null {
  const u = appUrl(ctx.appBaseUrl, '/apple-touch-icon.png')
  return u && u.startsWith('https://') ? u : null
}

/** The header line: the branch name alone (it already carries the shop's name); the shop name only when unknown. */
function eyebrow(ctx: RenderContext): string {
  return clip(ctx.branchName, 60) || SHOP_NAME
}

type CustomerSpec = {
  title: keyof CustomerLine['titles']
  sentence: keyof CustomerLine
  vars: (p: Payload, l: CustomerLine, loc: LineLocale) => Record<string, string>
  button: 'bottles' | 'ticket' | null
}

const reason = (p: Payload, l: CustomerLine) => clip(p.reason, 200) || l.noReason
const item = (p: Payload) => clip(p.item, 80)
const code = (p: Payload) => clip(p.code, 30)
const booking = (p: Payload, _l: CustomerLine, loc: LineLocale) => ({
  code: code(p),
  date: lineDate(p.night, loc),
  time: slotTime(p.time),
  party: int(p.party),
})

const CUSTOMER: Record<(typeof CUSTOMER_KINDS)[number], CustomerSpec> = {
  deposit_confirmed: {
    title: 'depositConfirmed',
    sentence: 'depositConfirmed',
    vars: (p, l, loc) => ({ item: item(p), count: int(p.quantity), code: code(p), date: lineDate(p.expires_at, loc) || l.noExpiry }),
    button: 'bottles',
  },
  deposit_rejected: { title: 'depositRejected', sentence: 'depositRejected', vars: (p, l) => ({ item: item(p), reason: reason(p, l) }), button: 'bottles' },
  withdraw_completed: {
    title: 'withdrawCompleted',
    sentence: 'withdrawCompleted',
    vars: (p) => ({ item: item(p), count: int(p.count), left: int(p.remaining) }),
    button: 'bottles',
  },
  withdraw_rejected: { title: 'withdrawRejected', sentence: 'withdrawRejected', vars: (p, l) => ({ item: item(p), reason: reason(p, l) }), button: 'bottles' },
  // the branch's own wording or the default, filled by expirySentence (R-044)
  expiry_soon: { title: 'expirySoon', sentence: 'expiryReminder', vars: () => ({}), button: 'bottles' },
  expired: { title: 'expired', sentence: 'expired', vars: (p) => ({ item: item(p), code: code(p) }), button: 'bottles' },
  disposed: { title: 'disposed', sentence: 'disposed', vars: (p) => ({ item: item(p), code: code(p) }), button: 'bottles' },
  booking_confirmed: { title: 'bookingConfirmed', sentence: 'bookingConfirmed', vars: booking, button: 'ticket' },
  booking_pending: { title: 'bookingPending', sentence: 'bookingPending', vars: booking, button: 'ticket' },
  booking_rejected: { title: 'bookingRejected', sentence: 'bookingRejected', vars: (p, l, loc) => ({ ...booking(p, l, loc), reason: reason(p, l) }), button: null },
  booking_cancelled: { title: 'bookingCancelled', sentence: 'bookingCancelled', vars: booking, button: null },
  booking_reminder: { title: 'bookingReminder', sentence: 'bookingReminder', vars: booking, button: 'ticket' },
}

function customerButton(kind: CustomerSpec['button'], p: Payload, l: CustomerLine, ctx: RenderContext) {
  if (kind === 'bottles') {
    const uri = liffUrl(ctx.liffId)
    return uri ? { label: l.viewBottles, uri } : null
  }
  if (kind === 'ticket') {
    const c = typeof p.code === 'string' && /^BK-\d{4}-\d{3}$/.test(p.code) ? p.code : null
    const uri = c ? liffUrl(ctx.liffId, `/ticket/${c}`) : null
    return uri ? { label: l.viewTicket, uri } : null
  }
  return null
}

/**
 * The expiry reminder (R-044): the branch's wording for this language when the run put one in
 * the payload, else the default; {{day}} is the days left the run counted (or, for an old row,
 * counted here from the expiry date).
 */
function expirySentence(p: Payload, l: CustomerLine, loc: LineLocale, ctx: RenderContext): string {
  const own = typeof p.template === 'string' ? clip(p.template, TEMPLATE_MAX) : ''
  const days = typeof p.days === 'number' && Number.isFinite(p.days) ? Math.trunc(p.days) : daysUntilBangkok(p.expires_at)
  return fillExpiryTemplate(own || l.expiryReminder, {
    day: days === null ? '' : String(Math.max(0, days)),
    item: item(p),
    code: code(p),
    date: lineDate(p.expires_at, loc) || l.noExpiry,
    deadline: lineDateTime(p.deadline, loc),
    branch: eyebrow(ctx),
  })
}

function renderCustomer(kind: (typeof CUSTOMER_KINDS)[number], loc: LineLocale, p: Payload, ctx: RenderContext): LineMessage {
  const l = customerLine(loc)
  const spec = CUSTOMER[kind]
  const title = l.titles[spec.title]
  const sentence = kind === 'expiry_soon' ? expirySentence(p, l, loc, ctx) : interpolate(l[spec.sentence] as string, spec.vars(p, l, loc))
  return bubble({
    theme: 'customer',
    eyebrow: eyebrow(ctx),
    title,
    lines: [{ text: sentence }],
    altText: `${title} · ${sentence}`,
    button: customerButton(spec.button, p, l, ctx),
    logoUrl: logoUrl(ctx),
  })
}

function renderStaff(kind: (typeof STAFF_KINDS)[number], p: Payload, ctx: RenderContext): LineMessage {
  const s = staffLine()
  const depositId = typeof p.deposit_id === 'string' && UUID.test(p.deposit_id) ? p.deposit_id : null
  const night = typeof p.night === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.night) ? p.night : null
  const table = clip(p.table, 20)
  let title = ''
  const lines: { text: string; muted?: boolean; strong?: boolean }[] = []
  let path: string | null = null

  if (kind === 'deposit_requested' || kind === 'withdrawal_requested') {
    title = interpolate(kind === 'deposit_requested' ? s.depositRequestedTitle : s.withdrawalRequestedTitle, { code: code(p) })
    lines.push({ text: interpolate(s.requestBody, { customer: clip(p.customer, 60), item: item(p), count: int(p.count) }), strong: true })
    if (kind === 'withdrawal_requested' && (p.type === 'in_store' || p.type === 'take_home')) {
      lines.push({ text: p.type === 'in_store' ? s.inStore : s.takeHome })
    }
    if (table) lines.push({ text: interpolate(s.tableLine, { table }), muted: true })
    path = depositId ? `/deposits/${depositId}` : null
  } else if (kind === 'booking_new') {
    title = interpolate(s.bookingNewTitle, { code: code(p) })
    lines.push({ text: interpolate(s.bookingNewBody, { name: clip(p.name, 60), party: int(p.party) }), strong: true })
    lines.push({ text: interpolate(s.bookingNewWhen, { date: lineDate(p.night, 'th'), time: slotTime(p.time) }) })
    path = night ? `/bookings?night=${night}` : '/bookings'
  } else {
    title = s.testTitle
    const at = p.at ?? new Date().toISOString()
    lines.push({ text: interpolate(s.testBody, { date: lineDate(at, 'th'), time: lineTime(at) }) })
  }

  const uri = path ? appUrl(ctx.appBaseUrl, path) : null
  return bubble({
    theme: 'staff',
    eyebrow: eyebrow(ctx),
    title,
    lines,
    altText: [title, ...lines.map((l) => l.text)].join(' · '),
    button: uri ? { label: s.open, uri } : null,
    logoUrl: logoUrl(ctx),
  })
}

const link = (label: string, uri: string | null): BubbleButton | null => (uri ? { label, uri } : null)

function renderReply(kind: (typeof REPLY_KINDS)[number], loc: LineLocale, p: Payload, ctx: RenderContext): LineMessage {
  const l = customerLine(loc)
  const base = { theme: 'customer' as const, eyebrow: eyebrow(ctx), logoUrl: logoUrl(ctx) }
  const app = (path = '') => liffUrl(ctx.liffId, path)
  // a customer reply with one sentence; the sentence becomes "ask the staff" when the LIFF app is not set up
  const simple = (title: string, sentence: string, button: BubbleButton | null, extra: { more?: (BubbleButton | null)[]; hint?: string; badge?: string } = {}) => {
    const lines = [{ text: sentence }, ...(button ? [] : [{ text: l.kwNoApp, muted: true }])]
    return bubble({ ...base, title, lines, altText: `${title} · ${sentence}`, button, ...extra })
  }

  switch (kind) {
    case 'linked': {
      const title = l.titles.linked
      const head = interpolate(l.linked, { code: code(p) })
      const detail = interpolate(l.linkedDetail, { item: item(p), left: int(p.remaining), count: int(p.quantity) })
      const expiry = p.is_vip === true || !p.expires_at ? l.noExpiry : interpolate(l.expiresOn, { date: lineDate(p.expires_at, loc) })
      return bubble({
        ...base,
        title,
        lines: [{ text: head }, { text: detail, strong: true }, { text: expiry, muted: true }],
        altText: `${title} · ${head} · ${detail}`,
        button: link(l.viewBottles, app()),
        hint: l.hint,
      })
    }
    case 'welcome':
      return bubble({
        ...base,
        title: l.titles.welcome,
        lines: [{ text: l.welcome }],
        altText: `${l.titles.welcome} · ${l.welcome}`,
        button: link(l.openApp, app()),
        more: [link(l.btnBook, app('/book')), link(l.btnDeposit, app('/deposit'))],
        hint: l.hint,
      })
    case 'link_not_found':
      return bubble({ ...base, title: l.titles.linkNotFound, lines: [{ text: l.linkNotFound }], altText: l.linkNotFound, hint: l.hint })
    case 'use_receipt_code':
      return bubble({ ...base, title: l.titles.useReceiptCode, lines: [{ text: l.useReceiptCode }], altText: l.useReceiptCode })
    case 'throttled':
      return bubble({ ...base, title: l.titles.throttled, lines: [{ text: l.throttled }], altText: l.throttled })
    case 'group_bound': {
      const s = staffLine()
      const body = interpolate(s.groupBound, { branch: clip(ctx.branchName, 40) })
      return bubble({ theme: 'staff', eyebrow: eyebrow(ctx), title: s.groupBoundTitle, lines: [{ text: body }], altText: `${s.groupBoundTitle} · ${body}`, logoUrl: logoUrl(ctx) })
    }
    case 'kw_deposit':
      return simple(l.titles.kwDeposit, l.kwDeposit, link(l.btnDeposit, app('/deposit')), { more: [link(l.viewBottles, app())], hint: l.hint })
    case 'kw_withdraw':
      return simple(l.titles.kwWithdraw, l.kwWithdraw, link(l.btnWithdraw, app()), { hint: l.hint })
    case 'kw_bottles':
      return simple(l.titles.kwBottles, l.kwBottles, link(l.viewBottles, app()), { more: [link(l.btnDeposit, app('/deposit'))], hint: l.hint })
    case 'kw_book':
      return simple(l.titles.kwBook, l.kwBook, link(l.btnBook, app('/book')), { more: [link(l.btnTickets, app('/tickets'))], hint: l.hint })
    case 'kw_tickets':
      return simple(l.titles.kwTickets, l.kwTickets, link(l.btnTickets, app('/tickets')), { more: [link(l.btnBook, app('/book'))], hint: l.hint })
    case 'kw_menu':
      return simple(l.titles.kwMenu, l.kwMenu, link(l.viewBottles, app()), {
        more: [link(l.btnDeposit, app('/deposit')), link(l.btnBook, app('/book')), link(l.btnTickets, app('/tickets'))],
        hint: l.hint,
      })
  }
}

const has = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v)

export function renderMessage(kind: string, locale: string | null | undefined, payload: unknown, ctx: RenderContext = {}): LineMessage | null {
  try {
    const loc: LineLocale = isLineLocale(locale) ? locale : 'th'
    const p: Payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : {}
    if (has(CUSTOMER_KINDS, kind)) return renderCustomer(kind, loc, p, ctx)
    if (has(STAFF_KINDS, kind)) return renderStaff(kind, p, ctx)
    if (has(REPLY_KINDS, kind)) return renderReply(kind, loc, p, ctx)
    return null
  } catch {
    return null
  }
}
