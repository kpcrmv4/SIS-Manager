import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { dbErrorCode } from '@/lib/errors'
import type { Dashboard, Trends } from './dashboard-view'

export type { Dashboard, Trends } from './dashboard-view'

/** The overview's "now" snapshot (owner_dashboard RPC, R-030). Throws — the page's error.tsx renders retry. */
export async function getDashboard(): Promise<Dashboard> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('owner_dashboard')
  if (error) throw new Error(`dashboard: ${dbErrorCode(error)}`)
  return data as unknown as Dashboard
}

/** Previous-period figures, 8 weekly points, busy weekdays, the period's top lists (owner_trends RPC). */
export async function getTrends(from: string, to: string, prev: { from: string; to: string }): Promise<Trends> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('owner_trends', { p_from: from, p_to: to, p_prev_from: prev.from, p_prev_to: prev.to })
  if (error) throw new Error(`trends: ${dbErrorCode(error)}`)
  return data as unknown as Trends
}
