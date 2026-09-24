import { NIGHT_ROLLOVER_HOUR } from '@/lib/date'
import type { Database } from '@/types/database'

/**
 * Pure helpers shared by the floor plan, the booking list and the booking
 * sheet — no server-only imports, safe in Client Components. "Late" and
 * "no-show" both depend on wall-clock time against the booking's slot, so
 * every caller goes through the same math (CLAUDE.md §7: Bangkok = UTC+7,
 * no DST, so a fixed offset is exact, not an approximation).
 */

export type BookingStatus = Database['public']['Enums']['booking_status']

/** Live = still occupies its slot (mirrors private.live_bookings in SQL). */
export const LIVE_STATUSES: BookingStatus[] = ['pending', 'confirmed', 'arrived']

/** The instant (epoch ms) a night+slot combination refers to in Bangkok time. */
export function slotInstant(night: string, slotTime: string): number {
  const [y, m, d] = night.split('-').map(Number)
  const [hh, mm] = slotTime.slice(0, 5).split(':').map(Number)
  const dayOffset = hh < NIGHT_ROLLOVER_HOUR ? 1 : 0
  return Date.UTC(y, m - 1, d + dayOffset, hh - 7, mm)
}

/** Whole minutes past the slot start (negative = still ahead of it). */
export function minutesLate(night: string, slotTime: string, now: number = Date.now()): number {
  return Math.floor((now - slotInstant(night, slotTime)) / 60000)
}

export type CellState = 'free' | 'pending' | 'booked' | 'arrived' | 'late'

/**
 * The floor-plan cell state for a single booking (only called for live statuses). A booking still
 * waiting for the shop that holds a table — the customer picked it, or bar seated it early — reads
 * รอยืนยัน even once late (R-055): it wants a decision first.
 */
export function cellState(status: BookingStatus, night: string, slotTime: string, now: number = Date.now()): CellState {
  if (status === 'arrived') return 'arrived'
  if (status === 'pending') return 'pending'
  if (!LIVE_STATUSES.includes(status)) return 'free'
  return minutesLate(night, slotTime, now) > 0 ? 'late' : 'booked'
}

/** HH:MM slots from slot_start to slot_end every slot_minutes (mirrors private.slots in SQL). */
export function slotOptions(start: string, end: string, minutes: number): string[] {
  const [sh, sm] = start.slice(0, 5).split(':').map(Number)
  const [eh, em] = end.slice(0, 5).split(':').map(Number)
  const startM = sh * 60 + sm
  // an end before the start runs past midnight (20:00–02:00), as private.slots does
  const endM = eh * 60 + em + (eh * 60 + em < startM ? 1440 : 0)
  const out: string[] = []
  if (minutes <= 0) return out
  for (let m = startM; m <= endM; m += minutes) {
    out.push(`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return out
}

export type BadgeTone = 'pending' | 'progress' | 'done' | 'info' | 'urgent'

/** Status → badge tone, fixed for the whole app (see components/ui/badge.tsx). */
export function bookingBadgeTone(status: BookingStatus): BadgeTone {
  switch (status) {
    case 'confirmed':
      return 'info'
    case 'arrived':
      return 'done'
    case 'rejected':
    case 'cancelled':
      return 'urgent'
    case 'no_show':
    case 'pending':
    default:
      return 'pending'
  }
}
