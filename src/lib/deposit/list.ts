import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { searchOr } from './search'
import type { DepositStatus } from './format'

export const PAGE_SIZE = 25

export type DepositTab = 'inStore' | 'toConfirm' | 'withdraw' | 'requests' | 'expired' | 'closed'
export const DEPOSIT_TABS: DepositTab[] = ['inStore', 'toConfirm', 'withdraw', 'requests', 'expired', 'closed']

export function parseTab(raw: string | undefined): DepositTab {
  return (DEPOSIT_TABS as string[]).includes(raw ?? '') ? (raw as DepositTab) : 'inStore'
}

const TAB_STATUSES: Partial<Record<DepositTab, DepositStatus[]>> = {
  inStore: ['in_store', 'pending_withdrawal'],
  toConfirm: ['pending_confirm'],
  requests: ['requested'],
  expired: ['expired'],
  closed: ['withdrawn', 'disposed', 'cancelled'],
}

export type DepositListRow = {
  id: string
  code: string
  customerName: string
  customerPhone: string | null
  itemName: string
  quantity: number
  remainingQty: number
  remainingPercent: number
  status: DepositStatus
  isVip: boolean
  expiresAt: string | null
  collectDeadlineAt: string | null
  expiredNoticeSentAt: string | null
  tableLabel: string | null
}

const SELECT =
  'id, code, customer_name, customer_phone, item_name, quantity, remaining_qty, remaining_percent, status, is_vip, expires_at, collect_deadline_at, expired_notice_sent_at, table_label'

type DepositRawRow = {
  id: string
  code: string
  customer_name: string
  customer_phone: string | null
  item_name: string
  quantity: number
  remaining_qty: number
  remaining_percent: number
  status: DepositStatus
  is_vip: boolean
  expires_at: string | null
  collect_deadline_at: string | null
  expired_notice_sent_at: string | null
  table_label: string | null
}

function mapRow(d: DepositRawRow): DepositListRow {
  return {
    id: d.id,
    code: d.code,
    customerName: d.customer_name,
    customerPhone: d.customer_phone,
    itemName: d.item_name,
    quantity: d.quantity,
    remainingQty: d.remaining_qty,
    remainingPercent: Number(d.remaining_percent),
    status: d.status,
    isVip: d.is_vip,
    expiresAt: d.expires_at,
    collectDeadlineAt: d.collect_deadline_at,
    expiredNoticeSentAt: d.expired_notice_sent_at,
    tableLabel: d.table_label,
  }
}

/**
 * Deposits with a pending withdrawal request (branch-scoped). A withdrawal request is
 * one row per bottle, so several rows can share one deposit_id — the "ขอเบิก" tab
 * shows one row per DEPOSIT, not per bottle (DESIGN.md / CLAUDE.md deposit tab rules).
 * Bounded at 1000 — a branch's pending-withdrawal queue is an operational backlog,
 * never a historical table.
 */
async function pendingWithdrawalDepositIds(branchId: string): Promise<string[]> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('withdrawals').select('deposit_id').eq('branch_id', branchId).eq('status', 'pending').range(0, 999)
  if (error || !data) return []
  return Array.from(new Set(data.map((w) => w.deposit_id)))
}

export async function listDeposits(
  branchId: string,
  tab: DepositTab,
  q: string,
  page: number,
): Promise<{ rows: DepositListRow[]; total: number }> {
  const sb = await getSupabaseServer()
  const from = (Math.max(page, 1) - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const term = q.trim()

  if (tab === 'withdraw') {
    let ids = await pendingWithdrawalDepositIds(branchId)
    if (term) {
      const { data: matched } = await sb.from('deposits').select('id').eq('branch_id', branchId).or(searchOr(['customer_name', 'customer_phone', 'code'], term)).range(0, 999)
      const matchedIds = new Set((matched ?? []).map((m) => m.id))
      ids = ids.filter((id) => matchedIds.has(id))
    }
    const total = ids.length
    const pageIds = ids.slice(from, to + 1)
    if (!pageIds.length) return { rows: [], total }
    const { data, error } = await sb.from('deposits').select(SELECT).in('id', pageIds)
    if (error || !data) return { rows: [], total }
    const byId = new Map(data.map((d) => [d.id, mapRow(d as DepositRawRow)]))
    return { rows: pageIds.map((id) => byId.get(id)).filter((r): r is DepositListRow => !!r), total }
  }

  const statuses = TAB_STATUSES[tab] ?? TAB_STATUSES.inStore!
  let query = sb.from('deposits').select(SELECT, { count: 'exact' }).eq('branch_id', branchId).in('status', statuses)
  if (term) query = query.or(searchOr(['customer_name', 'customer_phone', 'code'], term))
  query = tab === 'expired' ? query.order('expires_at', { ascending: true }) : query.order('created_at', { ascending: false })
  const { data, error, count } = await query.range(from, to)
  if (error || !data) return { rows: [], total: 0 }
  return { rows: data.map((d) => mapRow(d as DepositRawRow)), total: count ?? data.length }
}

export async function depositTabCounts(branchId: string): Promise<Record<DepositTab, number>> {
  const sb = await getSupabaseServer()
  const [inStore, toConfirm, requests, expired, closed, withdrawIds] = await Promise.all([
    sb.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).in('status', TAB_STATUSES.inStore!),
    sb.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).in('status', TAB_STATUSES.toConfirm!),
    sb.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).in('status', TAB_STATUSES.requests!),
    sb.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).in('status', TAB_STATUSES.expired!),
    sb.from('deposits').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).in('status', TAB_STATUSES.closed!),
    pendingWithdrawalDepositIds(branchId),
  ])
  return {
    inStore: inStore.count ?? 0,
    toConfirm: toConfirm.count ?? 0,
    requests: requests.count ?? 0,
    expired: expired.count ?? 0,
    closed: closed.count ?? 0,
    withdraw: withdrawIds.length,
  }
}
