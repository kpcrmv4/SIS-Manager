import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { LIVE_STATUSES } from './format'
import type { BookingStatus } from './format'

/** Read-only helpers for Server Components (CLAUDE.md §6: every list query .order()+.range()). */

export type TableRow = {
  id: string
  label: string
  shape: string
  seatsMin: number
  seatsMax: number
  sort: number
  zoneId: string
}

export type ZoneRow = {
  id: string
  name: string
  sort: number
  customerBookable: boolean
  tables: TableRow[]
}

export async function zonesWithTables(branchId: string): Promise<{ zones: ZoneRow[]; error: string | null }> {
  const sb = await getSupabaseServer()
  const [{ data: zones, error: zError }, { data: tables, error: tError }] = await Promise.all([
    sb.from('table_zones').select('id, name, sort, customer_bookable').eq('branch_id', branchId).eq('active', true).order('sort').range(0, 199),
    sb.from('tables').select('id, label, shape, seats_min, seats_max, sort, zone_id').eq('branch_id', branchId).eq('active', true).order('sort').range(0, 999),
  ])
  if (zError) return { zones: [], error: zError.message }
  if (tError) return { zones: [], error: tError.message }
  const byZone = new Map<string, TableRow[]>()
  for (const t of tables ?? []) {
    const row: TableRow = { id: t.id, label: t.label, shape: t.shape, seatsMin: t.seats_min, seatsMax: t.seats_max, sort: t.sort, zoneId: t.zone_id }
    const list = byZone.get(t.zone_id) ?? []
    list.push(row)
    byZone.set(t.zone_id, list)
  }
  return {
    zones: (zones ?? []).map((z) => ({ id: z.id, name: z.name, sort: z.sort, customerBookable: z.customer_bookable, tables: byZone.get(z.id) ?? [] })),
    error: null,
  }
}

export type NightBooking = {
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
  zoneId: string | null
  zoneName: string | null
  tableId: string | null
  tableLabel: string | null
  qrToken: string
  customerId: string | null
  createdAt: string
}

const BOOKING_COLUMNS =
  'id, code, status, name, phone, note, night, slot_time, party_size, source, zone_id, table_id, qr_token, customer_id, created_at, zone:table_zones(name), table:tables(label)'

type BookingRowWithRefs = {
  id: string
  code: string
  status: BookingStatus
  name: string
  phone: string | null
  note: string | null
  night: string
  slot_time: string
  party_size: number
  source: 'line' | 'staff'
  zone_id: string | null
  table_id: string | null
  qr_token: string
  customer_id: string | null
  created_at: string
  zone: unknown
  table: unknown
}

const toNightBooking = (b: BookingRowWithRefs): NightBooking => ({
  id: b.id,
  code: b.code,
  status: b.status,
  name: b.name,
  phone: b.phone,
  note: b.note,
  night: b.night,
  slotTime: b.slot_time,
  party: b.party_size,
  source: b.source,
  zoneId: b.zone_id,
  zoneName: (b.zone as { name: string } | null)?.name ?? null,
  tableId: b.table_id,
  tableLabel: (b.table as { label: string } | null)?.label ?? null,
  qrToken: b.qr_token,
  customerId: b.customer_id,
  createdAt: b.created_at,
})

export async function nightBookings(branchId: string, night: string): Promise<{ bookings: NightBooking[]; error: string | null }> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('bookings').select(BOOKING_COLUMNS).eq('branch_id', branchId).eq('night', night).order('slot_time').range(0, 499)
  if (error) return { bookings: [], error: error.message }
  return { bookings: (data ?? []).map((b) => toNightBooking(b as BookingRowWithRefs)), error: null }
}

/** Every booking still waiting for the shop from `fromNight` on (tonight + later), night then slot order. */
export async function pendingBookings(branchId: string, fromNight: string): Promise<{ bookings: NightBooking[]; error: string | null }> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('branch_id', branchId)
    .eq('status', 'pending')
    .gte('night', fromNight)
    .order('night')
    .order('slot_time')
    .range(0, 199)
  if (error) return { bookings: [], error: error.message }
  return { bookings: (data ?? []).map((b) => toNightBooking(b as BookingRowWithRefs)), error: null }
}

export type BookingSettingsRow = {
  slotStart: string
  slotEnd: string
  slotMinutes: number
  partyMin: number
  partyMax: number
  noShowMinutes: number
}

export async function bookingSettingsRow(branchId: string): Promise<{ settings: BookingSettingsRow | null; error: string | null }> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('booking_settings')
    .select('slot_start, slot_end, slot_minutes, party_min, party_max, no_show_minutes')
    .eq('branch_id', branchId)
    .maybeSingle()
  if (error) return { settings: null, error: error.message }
  if (!data) return { settings: null, error: null }
  return {
    settings: {
      slotStart: data.slot_start,
      slotEnd: data.slot_end,
      slotMinutes: data.slot_minutes,
      partyMin: data.party_min,
      partyMax: data.party_max,
      noShowMinutes: data.no_show_minutes,
    },
    error: null,
  }
}

/** Occupied-table count, reservation count and people tonight — physical, not the booking cap. */
export function nightStats(bookings: NightBooking[], totalTables: number) {
  const live = bookings.filter((b) => LIVE_STATUSES.includes(b.status))
  const occupied = new Set(live.filter((b) => b.tableId).map((b) => b.tableId))
  return {
    reservations: live.length,
    people: live.reduce((sum, b) => sum + b.party, 0),
    booked: occupied.size,
    capacity: totalTables,
  }
}
