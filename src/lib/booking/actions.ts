'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { dispatchSoon } from '@/lib/line/dispatch'
import { callRpc, cleanText, isUuid } from '@/lib/action'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getActorState, isBarOrOwner } from '@/lib/auth/actor'
import { dbErrorCode, type ActionResult } from '@/lib/errors'
import type { BookingStatus } from './format'

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
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
  return res
}

export async function confirmBooking(bookingId: string, tableId?: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(bookingId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) =>
    sb.rpc('confirm_booking', { p_booking: bookingId, p_table: isUuid(tableId) ? tableId : undefined }),
  )
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
  return res
}

export async function rejectBooking(bookingId: string, reason: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(bookingId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) => sb.rpc('reject_booking', { p_booking: bookingId, p_reason: cleanText(reason, 200) ?? '' }))
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
  return res
}

export async function assignTable(bookingId: string, tableId: string | null): Promise<ActionResult<{ id: string; table_id: string | null }>> {
  if (!isUuid(bookingId) || (tableId !== null && !isUuid(tableId))) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; table_id: string | null }>((sb) =>
    sb.rpc('assign_table', { p_booking: bookingId, p_table: tableId as string }),
  )
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
  return res
}

export async function checkInBooking(branchId: string, ref: string): Promise<ActionResult<{ id: string; status: string; already: boolean }>> {
  const r = cleanText(ref, 64)
  if (!isUuid(branchId) || !r) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string; already: boolean }>((sb) => sb.rpc('check_in_booking', { p_branch: branchId, p_ref: r }))
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
  return res
}

export async function cancelBooking(bookingId: string, reason?: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(bookingId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) => sb.rpc('cancel_booking', { p_booking: bookingId, p_reason: cleanText(reason, 200) }))
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
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

/**
 * P2-B2: the booking sheet's data — the booking itself, the branch's tables (for
 * "เปลี่ยนโต๊ะ"), and the customer's in-store deposits at this branch (matched by
 * customer_id, else by phone) for the gold "มีเหล้าฝาก…" box.
 */
export type BookingDetail = {
  id: string
  code: string
  status: BookingStatus
  name: string
  phone: string | null
  note: string | null
  night: string
  slotTime: string
  party: number
  source: 'line' | 'staff'
  createdAt: string
  zoneId: string | null
  zoneName: string | null
  tableId: string | null
  tableLabel: string | null
  qrToken: string
  customerId: string | null
  /** bar/owner only — the scan result has no separate role prop, so it reads this. */
  canChangeTable: boolean
  tables: { id: string; label: string }[]
  deposits: { itemName: string; remainingPercent: number; expiresAt: string | null }[]
}

export async function getBookingDetail(branchId: string, bookingId: string): Promise<ActionResult<BookingDetail>> {
  if (!isUuid(branchId) || !isUuid(bookingId)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const { data: claims } = await sb.auth.getClaims()
  if (!claims?.claims?.sub) return { ok: false, error: 'unauthenticated' }

  // independent reads in parallel — this runs on every door scan
  const [{ data: booking, error }, actorState, { data: tables, error: tablesError }] = await Promise.all([
    sb
      .from('bookings')
      .select(
        'id, code, status, name, phone, note, night, slot_time, party_size, source, zone_id, table_id, qr_token, customer_id, created_at, zone:table_zones(name), table:tables(label)',
      )
      .eq('id', bookingId)
      .eq('branch_id', branchId)
      .maybeSingle(),
    getActorState(),
    sb.from('tables').select('id, label').eq('branch_id', branchId).eq('active', true).order('sort').range(0, 999),
  ])
  if (error) return { ok: false, error: dbErrorCode(error) }
  if (tablesError) return { ok: false, error: dbErrorCode(tablesError) }
  if (!booking) return { ok: false, error: 'NOT_FOUND' }
  const canChangeTable = actorState.status === 'ok' && isBarOrOwner(actorState.actor.role)

  let deposits: { item_name: string; remaining_percent: number; expires_at: string | null }[] = []
  if (booking.customer_id || booking.phone) {
    let q = sb.from('deposits').select('item_name, remaining_percent, expires_at').eq('branch_id', branchId).in('status', ['in_store', 'pending_withdrawal'])
    q = booking.customer_id ? q.eq('customer_id', booking.customer_id) : q.eq('customer_phone', booking.phone as string)
    const { data, error: depositsError } = await q.order('expires_at').range(0, 49)
    if (depositsError) return { ok: false, error: dbErrorCode(depositsError) }
    deposits = data ?? []
  }

  return {
    ok: true,
    data: {
      id: booking.id,
      code: booking.code,
      status: booking.status,
      name: booking.name,
      phone: booking.phone,
      note: booking.note,
      night: booking.night,
      slotTime: booking.slot_time,
      party: booking.party_size,
      source: booking.source,
      createdAt: booking.created_at,
      zoneId: booking.zone_id,
      zoneName: (booking.zone as { name: string } | null)?.name ?? null,
      tableId: booking.table_id,
      tableLabel: (booking.table as { label: string } | null)?.label ?? null,
      qrToken: booking.qr_token,
      customerId: booking.customer_id,
      canChangeTable,
      tables: (tables ?? []).map((t) => ({ id: t.id, label: t.label })),
      deposits: deposits.map((d) => ({ itemName: d.item_name, remainingPercent: d.remaining_percent, expiresAt: d.expires_at })),
    },
  }
}
