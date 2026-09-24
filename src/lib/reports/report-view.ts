import { addDays, weekdayIndex } from '@/lib/date'

/**
 * Shapes of owner_report_detail (R-034) and the pure decisions the reports page makes with
 * them. No server imports — the specs import this file directly.
 */

export type ReportDay = {
  day: string
  deposits: number
  bottles_in: number
  withdrawals: number
  bottles_out: number
  disposed: number
  bookings: number
  arrived: number
  no_shows: number
  cancelled: number
}

export type ReportStaff = {
  name: string
  role: 'staff' | 'bar' | 'owner'
  received: number
  confirmed: number
  withdrawals: number
  check_ins: number
  total: number
}

export type ReportDisposal = {
  id: string
  item: string
  customer: string
  branch: string
  branch_id: string
  expires_at: string | null
  disposed_at: string | null
  by: string | null
  notified: boolean
}

export type ReportDetail = {
  from: string
  to: string
  days: ReportDay[]
  top_items: { name: string; deposits: number; bottles: number }[]
  top_customers: { name: string; deposits: number; bottles: number; linked: boolean }[]
  staff: ReportStaff[]
  disposals: ReportDisposal[]
}

export type Bucket = Omit<ReportDay, 'day'> & { from: string; to: string }

const SUM_KEYS = ['deposits', 'bottles_in', 'withdrawals', 'bottles_out', 'disposed', 'bookings', 'arrived', 'no_shows', 'cancelled'] as const

/** Up to 62 days one bar per day; longer ranges one bar per Monday-started week. */
export const DAILY_LIMIT = 62

export function bucketDays(days: ReportDay[]): { unit: 'day' | 'week'; buckets: Bucket[] } {
  const zero = () => Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as Omit<ReportDay, 'day'>
  if (days.length <= DAILY_LIMIT) {
    return { unit: 'day', buckets: days.map(({ day, ...rest }) => ({ ...rest, from: day, to: day })) }
  }
  // days arrive in order; a new bucket starts whenever the Monday changes (the first may be partial)
  const buckets: Bucket[] = []
  let monday = ''
  for (const d of days) {
    const m = addDays(d.day, -weekdayIndex(d.day))
    if (m !== monday) {
      buckets.push({ ...zero(), from: d.day, to: d.day })
      monday = m
    }
    const b = buckets[buckets.length - 1]
    for (const k of SUM_KEYS) b[k] += d[k]
    b.to = d.day
  }
  return { unit: 'week', buckets }
}

/** Monday = 0 … Sunday = 6: bottles deposited and bookings (not cancelled / rejected) per weekday. */
export function weekdayTotals(days: ReportDay[]): { dow: number; bottles_in: number; bookings: number }[] {
  const out = Array.from({ length: 7 }, (_, dow) => ({ dow, bottles_in: 0, bookings: 0 }))
  for (const d of days) {
    const w = out[weekdayIndex(d.day)]
    w.bottles_in += d.bottles_in
    w.bookings += d.bookings
  }
  return out
}
