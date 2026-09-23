'use server'

import { getSupabaseServer } from '@/lib/supabase/server'
import { businessNight } from '@/lib/date'
import { isUuid } from '@/lib/action'
import { parseScan } from './parse'

export type ScanHit = { kind: 'deposit'; id: string } | { kind: 'booking'; id: string } | { kind: 'none' }

/**
 * Resolve a scan or a typed reference to one deposit or one booking of this branch.
 * Every read runs as the signed-in user, so RLS already limits it to their branches.
 */
export async function lookupScan(branchId: string, raw: string): Promise<ScanHit> {
  if (!isUuid(branchId)) return { kind: 'none' }
  const ref = parseScan(raw)
  if (ref.kind === 'none') return { kind: 'none' }
  const sb = await getSupabaseServer()
  const tonight = businessNight()

  if (ref.kind === 'deposit_code') {
    const { data } = await sb.from('deposits').select('id').eq('code', ref.value).eq('branch_id', branchId).maybeSingle()
    return data ? { kind: 'deposit', id: data.id } : { kind: 'none' }
  }
  if (ref.kind === 'booking_token') {
    const { data } = await sb.from('bookings').select('id').eq('qr_token', ref.value).eq('branch_id', branchId).maybeSingle()
    return data ? { kind: 'booking', id: data.id } : { kind: 'none' }
  }
  if (ref.kind === 'booking_code') {
    const { data } = await sb
      .from('bookings')
      .select('id, night')
      .eq('code', ref.value)
      .eq('branch_id', branchId)
      .order('night', { ascending: false })
      .range(0, 4)
    const hit = (data ?? []).find((b) => b.night === tonight) ?? data?.[0]
    return hit ? { kind: 'booking', id: hit.id } : { kind: 'none' }
  }
  // a table label: tonight's live booking at that table
  const { data: table } = await sb.from('tables').select('id').eq('branch_id', branchId).ilike('label', ref.value).maybeSingle()
  if (!table) return { kind: 'none' }
  const { data: booking } = await sb
    .from('bookings')
    .select('id')
    .eq('table_id', table.id)
    .eq('night', tonight)
    .in('status', ['pending', 'confirmed', 'arrived'])
    .order('slot_time')
    .range(0, 0)
    .maybeSingle()
  return booking ? { kind: 'booking', id: booking.id } : { kind: 'none' }
}
