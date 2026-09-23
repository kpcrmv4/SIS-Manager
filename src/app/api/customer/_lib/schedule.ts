import 'server-only'
import { addDays } from '@/lib/date'

/** Asia/Bangkok is a fixed UTC+7 offset — no DST to account for. */
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000

/**
 * Mirrors `private.slot_instant(night, slot, start)` (20260923160000_bookings.sql): a slot
 * before the night's opening time belongs to the small hours of the NEXT calendar day.
 */
export function slotInstant(night: string, slotHHMM: string, startHHMM: string): Date {
  const day = slotHHMM < startHHMM ? addDays(night, 1) : night
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = slotHHMM.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, h, mi) - TZ_OFFSET_MS)
}

/** A "HH:MM" time-of-day, `minutes` later (wraps past midnight — display only, no date rollover). */
export function addMinutesToTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
