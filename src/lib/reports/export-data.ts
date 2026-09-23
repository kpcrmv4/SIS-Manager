import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Detail rows for the Excel export, read through the owner's session (RLS) in chunks —
 * PostgREST silently caps a response at 1,000 rows (CLAUDE §6), so every sheet pages
 * with .order() + .range() until a short page comes back.
 */
type Sb = SupabaseClient<Database>
const CHUNK = 1000
const MAX_ROWS = 50_000 // one export never loads more than this per sheet

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const { data, error } = await page(from, from + CHUNK - 1)
    if (error) throw new Error(`export: ${error.code ?? error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < CHUNK) break
  }
  return out
}

const bkk = (ymd: string) => `${ymd}T00:00:00+07:00`
const nextDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export type DepositExportRow = {
  code: string
  customer_name: string
  customer_phone: string | null
  item_name: string
  quantity: number
  remaining_qty: number
  status: Database['public']['Enums']['deposit_status']
  received_at: string | null
  expires_at: string | null
  is_vip: boolean
  branch: { name: string } | null
}

export type WithdrawalExportRow = {
  qty: number
  type: Database['public']['Enums']['withdrawal_type']
  processed_at: string | null
  table_label: string | null
  by_customer: boolean
  deposit: { code: string; customer_name: string; item_name: string } | null
  branch: { name: string } | null
}

export type BookingExportRow = {
  code: string
  night: string
  slot_time: string
  party_size: number
  name: string
  phone: string | null
  status: Database['public']['Enums']['booking_status']
  source: Database['public']['Enums']['booking_source']
  table: { label: string } | null
  branch: { name: string } | null
}

export async function exportDetails(sb: Sb, from: string, to: string, branchId: string | null) {
  const t0 = bkk(from)
  const t1 = bkk(nextDay(to))
  const [deposits, withdrawals, bookings] = await Promise.all([
    fetchAll<DepositExportRow>((a, b) => {
      let q = sb
        .from('deposits')
        .select('code, customer_name, customer_phone, item_name, quantity, remaining_qty, status, received_at, expires_at, is_vip, branch:branches(name)')
        .gte('received_at', t0)
        .lt('received_at', t1)
      if (branchId) q = q.eq('branch_id', branchId)
      return q.order('received_at').order('id').range(a, b) as unknown as PromiseLike<{ data: DepositExportRow[] | null; error: { code?: string; message: string } | null }>
    }),
    fetchAll<WithdrawalExportRow>((a, b) => {
      let q = sb
        .from('withdrawals')
        .select('qty, type, processed_at, table_label, by_customer, deposit:deposits(code, customer_name, item_name), branch:branches(name)')
        .eq('status', 'completed')
        .gte('processed_at', t0)
        .lt('processed_at', t1)
      if (branchId) q = q.eq('branch_id', branchId)
      return q.order('processed_at').order('id').range(a, b) as unknown as PromiseLike<{ data: WithdrawalExportRow[] | null; error: { code?: string; message: string } | null }>
    }),
    fetchAll<BookingExportRow>((a, b) => {
      let q = sb
        .from('bookings')
        .select('code, night, slot_time, party_size, name, phone, status, source, table:tables(label), branch:branches(name)')
        .gte('night', from)
        .lte('night', to)
      if (branchId) q = q.eq('branch_id', branchId)
      return q.order('night').order('slot_time').order('id').range(a, b) as unknown as PromiseLike<{ data: BookingExportRow[] | null; error: { code?: string; message: string } | null }>
    }),
  ])
  return { deposits, withdrawals, bookings }
}
