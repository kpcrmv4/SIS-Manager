import { addDays } from '@/lib/date'
import type { BookingStatus } from '@/lib/booking/format'

/**
 * The customers page's search box reads what was typed (R-049). A booking code — "BK-0925", with or
 * without the dash, "bk0925", on to "BK-0925-001" — means that night's bookings, narrowed by the
 * number once it is typed. Half a date ("BK-09") asks for the rest; anything else searches customers.
 * Pure: the page and its tests share it.
 */

export type SmartQuery =
  | { kind: 'booking'; night: string; code: string; seq: string | null }
  | { kind: 'bookingHint'; reason: 'date' | 'badDate' }
  | { kind: 'text' }

const BOOKING = /^\s*bk[\s-]?(\d{0,4})(?:[\s-]?(\d{0,3}))?\s*$/i

export function parseSmartQuery(q: string, tonight: string): SmartQuery {
  const m = BOOKING.exec(q)
  if (!m) return { kind: 'text' }
  const [, mmdd, seq] = m
  if (mmdd.length < 4) return { kind: 'bookingHint', reason: 'date' }
  const night = nearestNight(mmdd, tonight)
  if (!night) return { kind: 'bookingHint', reason: 'badDate' }
  return { kind: 'booking', night, code: `BK-${mmdd}`, seq: seq ? seq : null }
}

/** The date with this month and day closest to tonight — last year, this year or next. */
export function nearestNight(mmdd: string, tonight: string): string | null {
  const month = Number(mmdd.slice(0, 2))
  const day = Number(mmdd.slice(2, 4))
  const year = Number(tonight.slice(0, 4))
  const base = Date.UTC(year, Number(tonight.slice(5, 7)) - 1, Number(tonight.slice(8, 10)))
  let best: { ymd: string; gap: number } | null = null
  for (const y of [year - 1, year, year + 1]) {
    const t = Date.UTC(y, month - 1, day)
    const d = new Date(t)
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) continue // 31/02, 29/02 of a common year
    const gap = t - base
    // a tie (never happens a year apart) would go to the coming night
    if (!best || Math.abs(gap) < Math.abs(best.gap) || (Math.abs(gap) === Math.abs(best.gap) && gap > 0)) {
      best = { ymd: d.toISOString().slice(0, 10), gap }
    }
  }
  return best?.ymd ?? null
}

/** The booking code of a night: BK-MMDD. */
export const nightCode = (night: string) => `BK-${night.slice(5, 7)}${night.slice(8, 10)}`

/** จองวันนี้ · จองพรุ่งนี้ — the codes the shortcuts type for you. */
export function shortcutCodes(tonight: string) {
  return { today: nightCode(tonight), tomorrow: nightCode(addDays(tonight, 1)) }
}

export type BoardTile = {
  id: string
  code: string
  time: string
  party: number
  status: BookingStatus
  source: 'line' | 'staff'
  name: string
  key: string | null
  table: string | null
  zone: string | null
  bottles: number
  is_vip: boolean
}

export type Board = { night: string; rows: BoardTile[] }

/** The tile filters: every live booking, or one state; cancelled and rejected only on their own. */
export type BoardFilter = 'live' | 'pending' | 'confirmed' | 'arrived' | 'no_show' | 'cancelled'
export const BOARD_FILTERS: BoardFilter[] = ['live', 'pending', 'confirmed', 'arrived', 'no_show', 'cancelled']

export function inBoardFilter(status: BookingStatus, f: BoardFilter): boolean {
  if (f === 'live') return status !== 'cancelled' && status !== 'rejected'
  if (f === 'cancelled') return status === 'cancelled' || status === 'rejected'
  return status === f
}
