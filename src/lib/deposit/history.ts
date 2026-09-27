import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { addDays } from '@/lib/date'

/** R-061 · ประวัติฝาก/เบิก: the branch's deposit_events, by business night. */

export const HISTORY_GROUPS = ['deposit', 'withdraw', 'expiry', 'other'] as const
export type HistoryGroup = (typeof HISTORY_GROUPS)[number]
export const HISTORY_PAGE = 50

export type HistoryRow = {
  id: string
  at: string
  action: string
  payload: Record<string, unknown>
  actor_kind: 'staff' | 'customer' | 'system'
  actor_name: string | null
  actor_role: 'staff' | 'bar' | 'owner' | null
  deposit_id: string
  code: string
  customer: string
  item: string
  group: HistoryGroup
}

export type HistoryFeed = {
  rows: HistoryRow[]
  total: number
  counts: Record<HistoryGroup, number>
  summary: { received: number; withdrawn: number; disposed: number }
  actors: { id: string; name: string | null; role: string }[]
}

export const isHistoryGroup = (v: unknown): v is HistoryGroup => typeof v === 'string' && (HISTORY_GROUPS as readonly string[]).includes(v)

/** A business night runs 06:00 → 06:00 Bangkok (NIGHT_ROLLOVER_HOUR); nights from..to as instants. */
export function nightSpan(from: string, to: string): { start: string; end: string } {
  return { start: `${from}T06:00:00+07:00`, end: `${addDays(to, 1)}T06:00:00+07:00` }
}

export async function getDepositHistory(input: {
  branchId: string
  from: string
  to: string
  group: HistoryGroup | null
  actor: string | null
  q: string
  page: number
}): Promise<HistoryFeed | null> {
  const { start, end } = nightSpan(input.from, input.to)
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('deposit_history', {
    p_branch: input.branchId,
    p_from: start,
    p_to: end,
    p_group: input.group ?? undefined,
    p_actor: input.actor ?? undefined,
    p_q: input.q || undefined,
    p_limit: HISTORY_PAGE,
    p_offset: (input.page - 1) * HISTORY_PAGE,
  })
  if (error || !data) return null
  return data as unknown as HistoryFeed
}
