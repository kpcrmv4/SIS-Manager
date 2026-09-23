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
