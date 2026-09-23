'use server'

import { revalidatePath } from 'next/cache'
import { callRpc, cleanText, isUuid } from '@/lib/action'
import type { ActionResult } from '@/lib/errors'

/** Booking state changes — one server action per RPC (P1-05 contract). */

function touched() {
  revalidatePath('/bookings')
  revalidatePath('/tonight')
  revalidatePath('/scan')
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isTime = (v: unknown): v is string => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)

export type BookingResult = { id: string; code: string; status: string; qr_token: string }

export async function createStaffBooking(input: {
  branchId: string
  night: string
  slot: string
  party: number
  name: string
  phone?: string
  zoneId?: string
  tableId?: string
  note?: string
}): Promise<ActionResult<BookingResult>> {
  if (!isUuid(input.branchId) || !isDate(input.night) || !isTime(input.slot) || !cleanText(input.name, 120)) return { ok: false, error: 'invalid' }
  const res = await callRpc<BookingResult>((sb) =>
    sb.rpc('create_booking', {
      p_branch: input.branchId,
      p_night: input.night,
      p_slot: input.slot,
      p_party: Math.trunc(input.party),
      p_name: cleanText(input.name, 120)!,
      p_phone: cleanText(input.phone, 20),
      p_zone: isUuid(input.zoneId) ? input.zoneId : undefined,
      p_table: isUuid(input.tableId) ? input.tableId : undefined,
      p_note: cleanText(input.note, 300),
    }),
  )
  if (res.ok) touched()
  return res
}

export async function confirmBooking(bookingId: string, tableId?: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(bookingId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) =>
    sb.rpc('confirm_booking', { p_booking: bookingId, p_table: isUuid(tableId) ? tableId : undefined }),
  )
  if (res.ok) touched()
  return res
}

export async function rejectBooking(bookingId: string, reason: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(bookingId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) => sb.rpc('reject_booking', { p_booking: bookingId, p_reason: cleanText(reason, 200) ?? '' }))
  if (res.ok) touched()
  return res
}

export async function assignTable(bookingId: string, tableId: string | null): Promise<ActionResult<{ id: string; table_id: string | null }>> {
  if (!isUuid(bookingId) || (tableId !== null && !isUuid(tableId))) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; table_id: string | null }>((sb) =>
    sb.rpc('assign_table', { p_booking: bookingId, p_table: tableId as string }),
  )
  if (res.ok) touched()
  return res
}

export async function checkInBooking(branchId: string, ref: string): Promise<ActionResult<{ id: string; status: string; already: boolean }>> {
  const r = cleanText(ref, 64)
  if (!isUuid(branchId) || !r) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string; already: boolean }>((sb) => sb.rpc('check_in_booking', { p_branch: branchId, p_ref: r }))
  if (res.ok) touched()
  return res
}

export async function cancelBooking(bookingId: string, reason?: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(bookingId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) => sb.rpc('cancel_booking', { p_booking: bookingId, p_reason: cleanText(reason, 200) }))
  if (res.ok) touched()
  return res
}

export type Availability = {
  line_enabled: boolean
  party_min: number
  party_max: number
  cancel_hours: number
  nights: {
    night: string
    closed: boolean
    reason: 'closed_weekday' | 'blackout' | 'past' | 'too_far' | 'cutoff' | null
    blackout_reason: string | null
    booked: number
    capacity: number | null
    full: boolean
    slots: string[]
  }[]
}

export async function bookingAvailability(branchId: string, from: string, to: string): Promise<ActionResult<Availability>> {
  if (!isUuid(branchId) || !isDate(from) || !isDate(to)) return { ok: false, error: 'invalid' }
  return callRpc<Availability>((sb) => sb.rpc('booking_availability', { p_branch: branchId, p_from: from, p_to: to }))
}
