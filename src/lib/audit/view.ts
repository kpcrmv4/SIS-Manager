/**
 * The audit log's shapes and the pure decisions the /audit page makes with them (R-038).
 * No server imports — the specs import this file directly.
 */

export const AUDIT_KINDS = ['deposit', 'withdrawal', 'booking', 'print', 'settings', 'users'] as const
export type AuditKind = (typeof AUDIT_KINDS)[number]
export const AUDIT_PAGE = 50

export type AuditRow = {
  id: number
  at: string
  branch_id: string | null
  actor_id: string | null
  actor_name: string | null
  actor_kind: 'staff' | 'customer' | 'system'
  actor_role: 'staff' | 'bar' | 'owner' | null
  category: AuditKind
  action: string
  target: string | null
  target_id: string | null
  details: Record<string, unknown>
}
export type AuditFeed = { counts: Partial<Record<AuditKind, number>>; total: number; rows: AuditRow[] }

export const isAuditKind = (v: unknown): v is AuditKind => typeof v === 'string' && (AUDIT_KINDS as readonly string[]).includes(v)

/** Deposit, withdrawal and print rows are copies of deposit_events: the deposit history wording covers them. */
export const isDepositEvent = (row: Pick<AuditRow, 'action'>) => row.action.startsWith('deposit.')

/** A booking row's summary fields — shown on its own line, not as changes (unless an edit changed them). */
const BOOKING_SUMMARY = new Set(['name', 'night', 'time', 'party', 'status'])

export type Change = { key: string; from?: unknown; to: unknown; diff: boolean }

const isPair = (v: unknown): v is [unknown, unknown] => Array.isArray(v) && v.length === 2

/**
 * What a row changed, for "รายละเอียด": old → new on an edit, the values on a create or delete.
 * An edit (".updated") stores every field as [old, new]; a booking stores its table as a pair
 * only when the table changed.
 */
export function changesOf(row: Pick<AuditRow, 'action' | 'category' | 'details'>): Change[] {
  if (isDepositEvent(row)) return []
  const edit = row.action.endsWith('.updated')
  const out: Change[] = []
  for (const [key, v] of Object.entries(row.details ?? {})) {
    if (row.category === 'booking') {
      if (/(_id|_at|_by)$/.test(key)) continue // internal stamps and ids — the row already says who and when
      if (BOOKING_SUMMARY.has(key) && !(edit && isPair(v))) continue
      if (key === 'table' && !isPair(v) && !row.action.endsWith('.created')) continue
    }
    if ((edit || (row.category === 'booking' && key === 'table')) && isPair(v)) out.push({ key, from: v[0], to: v[1], diff: true })
    else if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) out.push({ key, to: v, diff: false })
  }
  return out
}

/** The newest value of a summary field (an edit may have stored it as [old, new]). */
export const latest = (v: unknown): unknown => (isPair(v) ? v[1] : v)

export type ValueFormat = {
  on: string
  off: string
  none: string
  weekday: (i: number) => string
  date: (ymd: string) => string
  /** a coded value in words (role, shape, table choice, booking status …) or null */
  label: (key: string, v: string) => string | null
}

export function formatValue(key: string, v: unknown, f: ValueFormat): string {
  if (v === null || v === undefined || v === '') return f.none
  if (typeof v === 'boolean') return v ? f.on : f.off
  if (key === 'closed_weekdays' && Array.isArray(v)) return v.length ? v.map((i) => f.weekday(Number(i))).join(', ') : f.none
  if (Array.isArray(v)) return v.length ? v.map((x) => formatValue(key, x, f)).join(', ') : f.none
  if (typeof v === 'string') {
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(v)) return v.slice(0, 5)
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return f.date(v)
    return f.label(key, v) ?? v
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
