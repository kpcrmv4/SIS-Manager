import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { dbErrorCode } from '@/lib/errors'

/** Owner overview + report aggregates (P4-01). Numbers come from the owner-only RPCs. */

export { isYmd, parsePeriod, periodRange, showRate, reportTotals, REPORT_TOTAL_KEYS, type Period } from './period'

export type OverviewKpi = {
  branches: number
  in_store_bottles: number
  in_store_customers: number
  new_deposits: number
  bottles_withdrawn: number
  disposed: number
  awaiting_disposal: number
  bookings: number
  arrived: number
  no_shows: number
}

export type OverviewBranch = {
  id: string
  code: string
  name: string
  in_store_bottles: number
  to_confirm: number
  expiring: number
  to_dispose: number
  bookings_tonight: number
  arrived_tonight: number
}

export type RecentDisposal = {
  id: string
  item: string
  customer: string
  branch: string
  expires_at: string | null
  disposed_at: string | null
  by: string | null
  notified: boolean
}

export type Overview = { from: string; to: string; night: string; kpi: OverviewKpi; branches: OverviewBranch[]; recent_disposals: RecentDisposal[] }

export type ReportBranch = {
  id: string
  code: string
  name: string
  deposits_new: number
  bottles_new: number
  withdrawals: number
  bottles_withdrawn: number
  expired: number
  disposed: number
  bookings: number
  arrived: number
  no_shows: number
  cancelled: number
}

export type Report = { from: string; to: string; branches: ReportBranch[] }

/** Throws on failure — the page's error.tsx renders retry. */
export async function getOverview(from: string, to: string): Promise<Overview> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('owner_overview', { p_from: from, p_to: to })
  if (error) throw new Error(`overview: ${dbErrorCode(error)}`)
  return data as unknown as Overview
}

export async function getReport(from: string, to: string, branchId?: string | null): Promise<Report> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('owner_report', { p_from: from, p_to: to, p_branch: branchId ?? undefined })
  if (error) throw new Error(`report: ${dbErrorCode(error)}`)
  return data as unknown as Report
}
