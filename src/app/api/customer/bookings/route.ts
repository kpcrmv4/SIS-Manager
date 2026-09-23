import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { daysUntil } from '@/lib/date'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { readJsonBody } from '../_lib/body'
import { rpcError } from '../_lib/respond'
import { addMinutesToTime, slotInstant } from '../_lib/schedule'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const CANCELLABLE_STATUS = new Set(['pending', 'confirmed'])

type Row = {
  id: string
  code: string
  night: string
  slot_time: string
  party_size: number
  name: string
  phone: string | null
  note: string | null
  status: string
  qr_token: string
  table_zones: { name: string } | null
  tables: { label: string } | null
}

function shape(row: Row, settings: { customer_cancel_hours: number; slot_start: string; no_show_minutes: number } | null) {
  const cancellable =
    CANCELLABLE_STATUS.has(row.status) &&
    !!settings &&
    Date.now() < slotInstant(row.night, row.slot_time.slice(0, 5), settings.slot_start.slice(0, 5)).getTime() - settings.customer_cancel_hours * 3_600_000
  return {
    id: row.id,
    code: row.code,
    night: row.night,
    slotTime: row.slot_time.slice(0, 5),
    arriveBy: settings ? addMinutesToTime(row.slot_time.slice(0, 5), settings.no_show_minutes) : null,
    party: row.party_size,
    zone: row.table_zones?.name ?? null,
    table: row.tables?.label ?? null,
    name: row.name,
    phone: row.phone,
    note: row.note,
    status: row.status,
    qrToken: row.qr_token,
    cancellable,
  }
}

/**
 * GET without `code`: this customer's bookings at this branch (the "การจองของฉัน" list, P2-C3).
 * GET with `code`: one ticket — codes are unique per branch but not per year, so several nights
 * can share one; the nearest UPCOMING one wins, falling back to the most recent past one.
 */
export async function GET(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const code = req.nextUrl.searchParams.get('code')
  const admin = getSupabaseAdmin()

  let query = admin
    .from('bookings')
    .select('id, code, night, slot_time, party_size, name, phone, note, status, qr_token, table_zones(name), tables(label)')
    .eq('customer_id', s.customer.id)
    .eq('branch_id', s.branch.id)
    .order('night', { ascending: false })
    .range(0, 199)
  if (code) query = query.eq('code', code.trim().toUpperCase())
  const [{ data: rows, error }, { data: settings }] = await Promise.all([
    query,
    admin.from('booking_settings').select('customer_cancel_hours, slot_start, no_show_minutes').eq('branch_id', s.branch.id).maybeSingle(),
  ])
  if (error) return NextResponse.json({ error: 'unknown' }, { status: 503 })

  if (code) {
    const list = (rows ?? []) as unknown as Row[]
    if (list.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const upcoming = list.filter((r) => daysUntil(r.night) >= 0).sort((a, b) => (a.night < b.night ? -1 : 1))
    const chosen = upcoming[0] ?? list[0]
    return NextResponse.json({ booking: shape(chosen, settings) })
  }
  return NextResponse.json({ bookings: ((rows ?? []) as unknown as Row[]).map((r) => shape(r, settings)) })
}

type Body = { night?: string; slot?: string; party?: number; zone_id?: string | null; name?: string; phone?: string; note?: string }

/** "ส่งคำขอจอง" (P2-C3) → create_booking, scoped to this customer + branch server-side. */
export async function POST(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const parsed = await readJsonBody<Body>(req)
  if (!parsed.ok) return NextResponse.json({ error: 'invalid' }, { status: parsed.status })
  const { night, slot, party, zone_id, name, phone, note } = parsed.body

  if (!night || !YMD.test(night)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  if (!slot || !HHMM.test(slot)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  if (typeof party !== 'number' || !Number.isInteger(party) || party < 1 || party > 100) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : ''
  if (!cleanName) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (zone_id !== undefined && zone_id !== null && !UUID.test(zone_id)) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  const { data, error } = await getSupabaseAdmin().rpc('create_booking', {
    p_branch: s.branch.id,
    p_night: night,
    p_slot: `${slot}:00`,
    p_party: party,
    p_name: cleanName,
    p_phone: typeof phone === 'string' ? phone.trim().slice(0, 30) || undefined : undefined,
    p_zone: zone_id ?? undefined,
    p_note: typeof note === 'string' ? note.trim().slice(0, 300) || undefined : undefined,
    p_customer_id: s.customer.id,
  })
  if (error) return rpcError(error)
  return NextResponse.json({ ok: true, ...(data as object) }, { status: 201 })
}
