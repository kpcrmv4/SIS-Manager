import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { addDays, bangkokDate, businessNight } from '@/lib/date'
import type { Database } from '@/types/database'

type BookingStatus = Database['public']['Enums']['booking_status']

export type TonightBooking = {
  id: string
  code: string
  slotTime: string
  partySize: number
  name: string
  tableLabel: string | null
  status: BookingStatus
}

export type PendingTask =
  | { kind: 'confirm'; depositId: string; itemName: string; customerName: string; tableLabel: string | null; receivedAt: string | null }
  | { kind: 'withdraw'; depositId: string; itemName: string; customerName: string; tableLabel: string | null; count: number; createdAt: string }
  | { kind: 'request'; depositId: string; customerName: string; tableLabel: string | null }

export type ExpiringDeposit = {
  id: string
  itemName: string
  customerName: string
  expiresAt: string
  remainingQty: number
  remainingPercent: number
  notified: boolean
}

export type TonightData = {
  night: string
  bookings: TonightBooking[]
  bookingPeople: number
  bookingArrived: number
  toConfirmCount: number
  withdrawCount: number
  pendingWork: PendingTask[]
  expiring: ExpiringDeposit[]
  expiringNotifiedCount: number
}

/** Everything the /tonight board shows, one branch at a time (CLAUDE.md §7 — night = business night). */
export async function getTonightData(branchId: string, expiryNoticeDays: number): Promise<TonightData> {
  const sb = await getSupabaseServer()
  const night = businessNight()
  const noticeHorizon = `${addDays(bangkokDate(), expiryNoticeDays)}T23:59:59+07:00`

  const bookingsQ = sb
    .from('bookings')
    .select('id, code, slot_time, party_size, name, status, table:tables(label)')
    .eq('branch_id', branchId)
    .eq('night', night)
    .order('slot_time')
    .range(0, 199)

  const toConfirmQ = sb
    .from('deposits')
    .select('id, item_name, customer_name, table_label, received_at', { count: 'exact' })
    .eq('branch_id', branchId)
    .eq('status', 'pending_confirm')
    .order('received_at')
    .range(0, 49)

  const requestsQ = sb.from('deposits').select('id, customer_name, table_label').eq('branch_id', branchId).eq('status', 'requested').order('created_at').range(0, 49)

  const withdrawalsQ = sb
    .from('withdrawals')
    .select('deposit_id, table_label, created_at, deposit:deposits(item_name, customer_name)')
    .eq('branch_id', branchId)
    .eq('status', 'pending')
    .order('created_at')
    .range(0, 199)

  const expiringQ = sb
    .from('deposits')
    .select('id, item_name, customer_name, expires_at, remaining_qty, remaining_percent, expiry_notice_sent_at')
    .eq('branch_id', branchId)
    .in('status', ['in_store', 'pending_withdrawal'])
    .eq('is_vip', false)
    .not('expires_at', 'is', null)
    .lte('expires_at', noticeHorizon)
    .order('expires_at')
    .range(0, 49)

  const [{ data: bookingsRaw }, { data: toConfirmRaw, count: toConfirmCount }, { data: requestsRaw }, { data: withdrawalsRaw }, { data: expiringRaw }] = await Promise.all([
    bookingsQ,
    toConfirmQ,
    requestsQ,
    withdrawalsQ,
    expiringQ,
  ])

  const bookings: TonightBooking[] = (bookingsRaw ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    slotTime: b.slot_time,
    partySize: b.party_size,
    name: b.name,
    tableLabel: (b.table as unknown as { label: string } | null)?.label ?? null,
    status: b.status,
  }))

  const withdrawByDeposit = new Map<string, { itemName: string; customerName: string; tableLabel: string | null; count: number; createdAt: string }>()
  for (const w of withdrawalsRaw ?? []) {
    const dep = w.deposit as unknown as { item_name: string; customer_name: string } | null
    const existing = withdrawByDeposit.get(w.deposit_id)
    if (existing) {
      existing.count += 1
      if (w.created_at < existing.createdAt) existing.createdAt = w.created_at
    } else {
      withdrawByDeposit.set(w.deposit_id, { itemName: dep?.item_name ?? '', customerName: dep?.customer_name ?? '', tableLabel: w.table_label, count: 1, createdAt: w.created_at })
    }
  }

  const pendingWork: PendingTask[] = [
    ...(toConfirmRaw ?? []).map((d): PendingTask => ({ kind: 'confirm', depositId: d.id, itemName: d.item_name, customerName: d.customer_name, tableLabel: d.table_label, receivedAt: d.received_at })),
    ...Array.from(withdrawByDeposit.entries()).map(([depositId, w]): PendingTask => ({ kind: 'withdraw', depositId, ...w })),
    ...(requestsRaw ?? []).map((d): PendingTask => ({ kind: 'request', depositId: d.id, customerName: d.customer_name, tableLabel: d.table_label })),
  ]

  const expiring: ExpiringDeposit[] = (expiringRaw ?? []).map((d) => ({
    id: d.id,
    itemName: d.item_name,
    customerName: d.customer_name,
    expiresAt: d.expires_at!,
    remainingQty: d.remaining_qty,
    remainingPercent: Number(d.remaining_percent),
    notified: !!d.expiry_notice_sent_at,
  }))

  return {
    night,
    bookings,
    bookingPeople: bookings.reduce((sum, b) => sum + b.partySize, 0),
    bookingArrived: bookings.filter((b) => b.status === 'arrived').length,
    toConfirmCount: toConfirmCount ?? 0,
    withdrawCount: withdrawByDeposit.size,
    pendingWork,
    expiring,
    expiringNotifiedCount: expiring.filter((e) => e.notified).length,
  }
}
