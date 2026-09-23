import { addDays, bangkokDate } from '@/lib/date'

/** Pure helpers for the owner overview + reports (no server imports — specs use them too). */

export type Period = 'month' | 'last' | '30'

const YMD = /^\d{4}-\d{2}-\d{2}$/
export const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v)

export function parsePeriod(v: unknown): Period {
  return v === 'last' || v === '30' ? v : 'month'
}

/** Bangkok calendar range for a period chip (inclusive). */
export function periodRange(period: Period, today = bangkokDate()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number)
  if (period === '30') return { from: addDays(today, -29), to: today }
  if (period === 'last') {
    const first = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`
    return { from: first, to: addDays(`${today.slice(0, 7)}-01`, -1) }
  }
  return { from: `${today.slice(0, 7)}-01`, to: today }
}

const lastDayOfMonth = (ymd: string) => {
  const [y, m] = ymd.split('-').map(Number)
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1)
}

/**
 * The period a figure is compared with (R-030):
 *   month-to-date (1st … day N)  → the 1st … day N of the month before (clamped to its last day)
 *   a whole month                → the whole month before
 *   any other range              → the same number of days right before it
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  if (from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7)) {
    const prevLast = addDays(from, -1)
    const prevFrom = `${prevLast.slice(0, 7)}-01`
    if (to === lastDayOfMonth(to)) return { from: prevFrom, to: prevLast }
    const sameDay = `${prevLast.slice(0, 7)}-${to.slice(8)}`
    return { from: prevFrom, to: sameDay < prevLast ? sameDay : prevLast }
  }
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  const span = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
  const prevTo = addDays(from, -1)
  return { from: addDays(prevTo, -span), to: prevTo }
}

/** arrived ÷ (arrived + no-show), whole percent; null when nothing was decided yet. */
export function showRate(arrived: number, noShows: number): number | null {
  const decided = arrived + noShows
  return decided === 0 ? null : Math.round((arrived / decided) * 100)
}

export const REPORT_TOTAL_KEYS = ['deposits_new', 'bottles_new', 'withdrawals', 'bottles_withdrawn', 'expired', 'disposed', 'bookings', 'arrived', 'no_shows', 'cancelled'] as const
export type ReportTotalKey = (typeof REPORT_TOTAL_KEYS)[number]

export function reportTotals(rows: Record<ReportTotalKey, number>[]): Record<ReportTotalKey, number> {
  const out = Object.fromEntries(REPORT_TOTAL_KEYS.map((k) => [k, 0])) as Record<ReportTotalKey, number>
  for (const r of rows) for (const k of REPORT_TOTAL_KEYS) out[k] += Number(r[k]) || 0
  return out
}
