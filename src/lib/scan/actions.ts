'use server'

import { getSupabaseServer } from '@/lib/supabase/server'
import { businessNight } from '@/lib/date'
import { isUuid } from '@/lib/action'
import { parseSmartQuery, type Board } from '@/lib/customers/smart'
import { parseScan } from './parse'

export type ScanHit = { kind: 'deposit'; id: string } | { kind: 'booking'; id: string } | { kind: 'none' } | { kind: 'error' }

export type BoardLookup =
  | { kind: 'board'; board: Board; code: string; seq: string | null; tonight: string }
  | { kind: 'hint'; reason: 'date' | 'badDate' }
  | { kind: 'text' }
  | { kind: 'error' }

/**
 * A booking code typed on the scan page (R-052) — BK-0925, on to BK-0925-001 — as that night's
 * bookings for tiles, read the way the customers page reads it (R-049). Anything else is `text`:
 * the page keeps its one-reference lookup for it.
 */
export async function lookupBoard(branchId: string, raw: string): Promise<BoardLookup> {
  if (!isUuid(branchId) || typeof raw !== 'string') return { kind: 'text' }
  const tonight = businessNight()
  const smart = parseSmartQuery(raw.slice(0, 40), tonight)
  if (smart.kind === 'text') return { kind: 'text' }
  if (smart.kind === 'bookingHint') return { kind: 'hint', reason: smart.reason }
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('customer_booking_board', { p_branch: branchId, p_night: smart.night, p_seq: smart.seq ?? undefined })
  if (error) return { kind: 'error' }
  return { kind: 'board', board: data as unknown as Board, code: smart.code, seq: smart.seq, tonight }
}

/**
 * Resolve a scan or a typed reference to one deposit or one booking of this branch.
 * Every read runs as the signed-in user, so RLS already limits it to their branches.
 * A failed query is `error` (the page offers a retry), never folded into "not found".
 */
export async function lookupScan(branchId: string, raw: string): Promise<ScanHit> {
  if (!isUuid(branchId)) return { kind: 'none' }
  const ref = parseScan(raw)
  if (ref.kind === 'none') return { kind: 'none' }
  const sb = await getSupabaseServer()
  const tonight = businessNight()

  if (ref.kind === 'deposit_code') {
    const { data, error } = await sb.from('deposits').select('id').eq('code', ref.value).eq('branch_id', branchId).maybeSingle()
    if (error) return { kind: 'error' }
    return data ? { kind: 'deposit', id: data.id } : { kind: 'none' }
  }
  if (ref.kind === 'booking_token') {
    const { data, error } = await sb.from('bookings').select('id').eq('qr_token', ref.value).eq('branch_id', branchId).maybeSingle()
    if (error) return { kind: 'error' }
    return data ? { kind: 'booking', id: data.id } : { kind: 'none' }
  }
  if (ref.kind === 'booking_code') {
    const { data, error } = await sb
      .from('bookings')
      .select('id, night')
      .eq('code', ref.value)
      .eq('branch_id', branchId)
      .order('night', { ascending: false })
      .range(0, 4)
    if (error) return { kind: 'error' }
    const hit = (data ?? []).find((b) => b.night === tonight) ?? data?.[0]
    return hit ? { kind: 'booking', id: hit.id } : { kind: 'none' }
  }
  // a table label: tonight's live booking at that table
  const { data: table, error: tableError } = await sb.from('tables').select('id').eq('branch_id', branchId).ilike('label', ref.value).maybeSingle()
  if (tableError) return { kind: 'error' }
  if (!table) return { kind: 'none' }
  const { data: booking, error } = await sb
    .from('bookings')
    .select('id')
    .eq('table_id', table.id)
    .eq('night', tonight)
    .in('status', ['pending', 'confirmed', 'arrived'])
    .order('slot_time')
    .range(0, 0)
    .maybeSingle()
  if (error) return { kind: 'error' }
  return booking ? { kind: 'booking', id: booking.id } : { kind: 'none' }
}
