import { showRate } from './period'

/**
 * Shapes of the owner_dashboard / owner_trends RPCs (R-030) and the pure decisions the
 * overview makes with them. No server imports — the specs import this file directly.
 */

type Role = 'staff' | 'bar' | 'owner'
export type PrinterState = 'online' | 'offline' | 'not_set_up'

export type DashBranch = {
  id: string
  code: string
  name: string
  to_confirm: number
  requests: number
  withdrawals: number
  bookings_pending: number
  bookings_pending_night: string | null
  to_dispose: number
  expiring: number
  in_store_bottles: number
  bookings_tonight: number
  arrived_tonight: number
  printer: PrinterState
  line_oa: boolean
  liff: boolean
  staff_group: boolean
  line_failed: number
  has_tables: boolean
  has_items: boolean
  has_staff: boolean
  /** the last 7 business nights, oldest first: bottles received / withdrawn */
  nights: { night: string; in: number; out: number }[]
}

export type TonightHour = { hour: number; bookings: number; people: number; arrived: number; pending: number; no_show: number }

export type DashTonight = {
  night: string
  hours: TonightHour[]
  open_from: string | null
  open_to: string | null
  bottles_in: number
  bottles_out: number
}

export type FeedItem = {
  kind: 'deposit' | 'booking'
  key: string
  at: string
  action: string
  payload: Record<string, unknown>
  actor_kind: string
  actor: string | null
  actor_role: Role | null
  deposit_id?: string
  booking_id?: string
  code: string
  item?: string
  customer: string | null
  night?: string
  branch_id: string
  branch: string
}

export type ExpiringItem = {
  id: string
  code: string
  item: string
  customer: string
  branch_id: string
  branch: string
  expires_at: string
  remaining: number
  notified: boolean
  linked: boolean
}

export type Dashboard = {
  night: string
  generated_at: string
  branches: DashBranch[]
  tonight: DashTonight
  activity: FeedItem[]
  expiring: ExpiringItem[]
}

export type TrendWeek = {
  start: string
  new_deposits: number
  bottles_withdrawn: number
  disposed: number
  bookings: number
  arrived: number
  no_shows: number
  in_store_end: number
}

export type PeriodFigures = { from: string; to: string; new_deposits: number; bottles_withdrawn: number; disposed: number; bookings: number; arrived: number; no_shows: number }

export type Trends = {
  from: string
  to: string
  week0: string
  tonight: string
  prev: PeriodFigures
  weeks: TrendWeek[]
  weekdays: { dow: number; bookings: number; people: number; closed: boolean }[]
  top_customers: { name: string; deposits: number; bottles: number; linked: boolean }[]
  top_items: { name: string; deposits: number; bottles: number }[]
}

// ── links ──────────────────────────────────────────────────────────────────

/** Lists are scoped to the working branch: a link into another branch switches first (/api/branch/go). */
export function branchHref(branchId: string, path: string, working: string | null): string {
  if (path.startsWith('#') || branchId === working) return path
  return `/api/branch/go?b=${encodeURIComponent(branchId)}&to=${encodeURIComponent(path)}`
}

// ── ต้องจัดการ ─────────────────────────────────────────────────────────────

export const ACTION_KEYS = ['to_confirm', 'requests', 'withdrawals', 'bookings_pending', 'expiring', 'to_dispose', 'printers_offline', 'line_failed'] as const
export type ActionKey = (typeof ACTION_KEYS)[number]
export type ActionItem = { key: ActionKey; count: number; tone: 'progress' | 'info' | 'violet' | 'urgent'; href: string }

// a chip that opens a deposit group wears that group's hue (R-047)
const ACTIONS: Record<ActionKey, { tone: ActionItem['tone']; count: (b: DashBranch) => number; path: (b: DashBranch) => string }> = {
  to_confirm: { tone: 'progress', count: (b) => b.to_confirm, path: () => '/deposits?tab=toConfirm' },
  requests: { tone: 'info', count: (b) => b.requests, path: () => '/deposits?tab=requests' },
  withdrawals: { tone: 'violet', count: (b) => b.withdrawals, path: () => '/deposits?tab=withdraw' },
  bookings_pending: { tone: 'progress', count: (b) => b.bookings_pending, path: (b) => `/bookings?night=${b.bookings_pending_night ?? ''}&view=list` },
  expiring: { tone: 'progress', count: (b) => b.expiring, path: () => '#overview-expiring' },
  to_dispose: { tone: 'urgent', count: (b) => b.to_dispose, path: () => '/deposits?tab=expired' },
  printers_offline: { tone: 'urgent', count: (b) => (b.printer === 'offline' ? 1 : 0), path: () => '/settings/branch#print' },
  line_failed: { tone: 'urgent', count: (b) => b.line_failed, path: () => '/settings/line' },
}

/**
 * Totals across branches, only the ones above zero. The link opens the working branch when it
 * has some of that work, otherwise the branch with the most.
 */
export function actionItems(branches: DashBranch[], working: string | null): ActionItem[] {
  const out: ActionItem[] = []
  for (const key of ACTION_KEYS) {
    const def = ACTIONS[key]
    let total = 0
    let top: DashBranch | null = null
    for (const b of branches) {
      const n = def.count(b)
      total += n
      if (n > 0 && (!top || b.id === working || (top.id !== working && n > def.count(top)))) top = b
    }
    if (total > 0 && top) out.push({ key, count: total, tone: def.tone, href: branchHref(top.id, def.path(top), working) })
  }
  return out
}

// ── setup checklist ────────────────────────────────────────────────────────

export const SETUP_KEYS = ['line_oa', 'liff', 'staff_group', 'printer', 'tables', 'items', 'staff'] as const
export type SetupKey = (typeof SETUP_KEYS)[number]
export type SetupItem = { key: SetupKey; done: boolean; missing: string[]; href: string }

const SETUP: Record<SetupKey, { ok: (b: DashBranch) => boolean; path: string }> = {
  line_oa: { ok: (b) => b.line_oa, path: '/settings/line' },
  liff: { ok: (b) => b.liff, path: '/settings/line' },
  staff_group: { ok: (b) => b.staff_group, path: '/settings/line' },
  printer: { ok: (b) => b.printer !== 'not_set_up', path: '/settings/branch#print' },
  tables: { ok: (b) => b.has_tables, path: '/settings/tables' },
  items: { ok: (b) => b.has_items, path: '/settings/items' },
  staff: { ok: (b) => b.has_staff, path: '/settings/users' },
}

/** One item per setup step: done when every active branch has it; open items name the branches missing it. */
export function setupItems(branches: DashBranch[], working: string | null): SetupItem[] {
  return SETUP_KEYS.map((key) => {
    const missing = branches.filter((b) => !SETUP[key].ok(b))
    const first = missing.find((b) => b.id === working) ?? missing[0]
    return {
      key,
      done: branches.length > 0 && missing.length === 0,
      missing: missing.map((b) => b.name),
      href: first ? branchHref(first.id, SETUP[key].path, working) : SETUP[key].path,
    }
  })
}

// ── tonight ────────────────────────────────────────────────────────────────

/** 06:00 is the first hour of a business night, 05:00 the last. */
export const nightOrder = (hour: number) => (hour + 18) % 24

const hourOf = (hhmm: string | null) => (hhmm && /^\d{2}:\d{2}/.test(hhmm) ? Number(hhmm.slice(0, 2)) : null)

/** The hours to draw: the booking window plus any hour that has bookings, in business-night order. */
export function tonightHours(t: DashTonight): TonightHour[] {
  const byHour = new Map(t.hours.map((h) => [h.hour, h]))
  const hours = new Set(t.hours.map((h) => h.hour))
  const from = hourOf(t.open_from)
  const to = hourOf(t.open_to)
  if (from !== null && to !== null && nightOrder(from) <= nightOrder(to)) {
    for (let k = nightOrder(from); k <= nightOrder(to); k++) hours.add((k + 6) % 24)
  }
  return [...hours]
    .sort((a, b) => nightOrder(a) - nightOrder(b))
    .map((h) => byHour.get(h) ?? { hour: h, bookings: 0, people: 0, arrived: 0, pending: 0, no_show: 0 })
}

export function tonightTotals(t: DashTonight) {
  const s = { bookings: 0, people: 0, arrived: 0, pending: 0, no_show: 0 }
  for (const h of t.hours) {
    s.bookings += h.bookings
    s.people += h.people
    s.arrived += h.arrived
    s.pending += h.pending
    s.no_show += h.no_show
  }
  // confirmed and not here yet
  return { ...s, waiting: s.bookings - s.arrived - s.pending - s.no_show }
}

// ── trend ──────────────────────────────────────────────────────────────────

/** null = nothing to compare (both zero) · pct null = up from zero ("new") */
export type Delta = { dir: 'up' | 'down' | 'same'; pct: number | null } | null

export function delta(cur: number, prev: number): Delta {
  if (cur === prev) return cur === 0 ? null : { dir: 'same', pct: 0 }
  if (prev === 0) return { dir: 'up', pct: null }
  return { dir: cur > prev ? 'up' : 'down', pct: Math.abs(Math.round(((cur - prev) / prev) * 100)) }
}

/** Rates compare in percentage points; null when either side has nothing decided. */
export function pointsDelta(cur: number | null, prev: number | null): Delta {
  if (cur === null || prev === null) return null
  if (cur === prev) return { dir: 'same', pct: 0 }
  return { dir: cur > prev ? 'up' : 'down', pct: Math.abs(cur - prev) }
}

export const weeklyShowRate = (weeks: TrendWeek[]) => weeks.map((w) => showRate(w.arrived, w.no_shows))
