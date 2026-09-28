import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import type { BottleStatus, DepositStatus } from './format'

type Role = Database['public']['Enums']['user_role']
type WithdrawalType = Database['public']['Enums']['withdrawal_type']

export type DepositBottle = { id: string; bottleNo: number; remainingPercent: number; status: BottleStatus }

export type DepositEventRow = {
  id: number
  action: string
  payload: Record<string, unknown>
  createdAt: string
  actorKind: string
  actorName: string | null
  actorRole: Role | null
}

export type PendingWithdrawal = {
  id: string
  bottleId: string | null
  bottleNo: number | null
  type: WithdrawalType
  tableLabel: string | null
  createdAt: string
  /** the customer asked in LINE — else the staff member who asked */
  byCustomer: boolean
  requestedBy: string | null
}

export type DepositDetail = {
  id: string
  branchId: string
  code: string
  status: DepositStatus
  isVip: boolean
  itemId: string | null
  itemName: string
  category: string
  quantity: number
  remainingQty: number
  remainingPercent: number
  customerId: string | null
  /** the LINE-linked customer's expiry-reminder switch (R-044); null when not linked */
  customerReminders: boolean | null
  customerName: string
  customerPhone: string | null
  tableLabel: string | null
  createdAt: string
  receivedAt: string | null
  expiresAt: string | null
  collectDeadlineAt: string | null
  receivedByName: string | null
  confirmedByName: string | null
  photoPaths: string[]
  confirmPhotoPaths: string[]
  notes: string | null
  cancelReason: string | null
  disposeReason: string | null
  bottles: DepositBottle[]
  events: DepositEventRow[]
  pendingWithdrawals: PendingWithdrawal[]
}

type ProfileRef = { display_name: string; role: Role } | null

/**
 * Explicit row shapes for the nested selects below. supabase-js's generated types cannot
 * infer aliased embedded resources (`x:profiles!fkey(...)`), so the query results are cast
 * to these at the boundary instead of leaning on (and fighting) generic inference.
 */
type DepositDetailRow = {
  id: string
  branch_id: string
  code: string
  status: DepositStatus
  is_vip: boolean
  item_id: string | null
  item_name: string
  category: string
  quantity: number
  remaining_qty: number
  remaining_percent: number
  customer_id: string | null
  customer_name: string
  customer_phone: string | null
  table_label: string | null
  created_at: string
  received_at: string | null
  expires_at: string | null
  collect_deadline_at: string | null
  photo_paths: string[] | null
  confirm_photo_paths: string[] | null
  notes: string | null
  cancel_reason: string | null
  dispose_reason: string | null
  received_by_profile: ProfileRef
  confirmed_by_profile: ProfileRef
  customer: { expiry_notices_enabled: boolean } | null
}

type EventRow = {
  id: number
  action: string
  payload: Record<string, unknown> | null
  actor_kind: string
  created_at: string
  actor: ProfileRef
}

type PendingWithdrawalRow = {
  id: string
  bottle_id: string | null
  type: WithdrawalType
  table_label: string | null
  created_at: string
  by_customer: boolean
  bottle: { bottle_no: number } | null
  requester: { display_name: string } | null
}

/** Full deposit + bottles + history + open withdrawal requests, scoped to the branch the caller is working in. */
export async function getDepositDetail(branchId: string, id: string): Promise<DepositDetail | null> {
  const sb = await getSupabaseServer()

  const depositQ = sb
    .from('deposits')
    .select(
      `id, branch_id, code, status, is_vip, item_id, item_name, category, quantity, remaining_qty, remaining_percent,
       customer_id, customer_name, customer_phone, table_label, created_at, received_at, expires_at, collect_deadline_at,
       photo_paths, confirm_photo_paths, notes, cancel_reason, dispose_reason,
       received_by_profile:profiles!deposits_received_by_fkey(display_name, role),
       confirmed_by_profile:profiles!deposits_confirmed_by_fkey(display_name, role),
       customer:customers!deposits_customer_id_fkey(expiry_notices_enabled)`,
    )
    .eq('id', id)
    .eq('branch_id', branchId)
    .maybeSingle()

  const bottlesQ = sb.from('deposit_bottles').select('id, bottle_no, remaining_percent, status').eq('deposit_id', id).order('bottle_no').range(0, 199)

  const eventsQ = sb
    .from('deposit_events')
    .select('id, action, payload, actor_kind, created_at, actor:profiles!deposit_events_actor_id_fkey(display_name, role)')
    .eq('deposit_id', id)
    .order('created_at', { ascending: false })
    .range(0, 199)

  const pendingQ = sb
    .from('withdrawals')
    .select('id, bottle_id, type, table_label, created_at, by_customer, bottle:deposit_bottles(bottle_no), requester:profiles!withdrawals_requested_by_fkey(display_name)')
    .eq('deposit_id', id)
    .eq('status', 'pending')
    .order('created_at')
    .range(0, 49)

  const [{ data: depRaw, error: depErr }, { data: bottleRows }, { data: eventRowsRaw }, { data: pendingRowsRaw }] = await Promise.all([depositQ, bottlesQ, eventsQ, pendingQ])
  const dep = depRaw as unknown as DepositDetailRow | null
  if (depErr || !dep) return null
  const eventRows = (eventRowsRaw ?? []) as unknown as EventRow[]
  const pendingRows = (pendingRowsRaw ?? []) as unknown as PendingWithdrawalRow[]

  const received = dep.received_by_profile
  const confirmed = dep.confirmed_by_profile

  return {
    id: dep.id,
    branchId: dep.branch_id,
    code: dep.code,
    status: dep.status,
    isVip: dep.is_vip,
    itemId: dep.item_id,
    itemName: dep.item_name,
    category: dep.category,
    quantity: dep.quantity,
    remainingQty: dep.remaining_qty,
    remainingPercent: Number(dep.remaining_percent),
    customerId: dep.customer_id,
    customerReminders: dep.customer_id ? (dep.customer?.expiry_notices_enabled ?? true) : null,
    customerName: dep.customer_name,
    customerPhone: dep.customer_phone,
    tableLabel: dep.table_label,
    createdAt: dep.created_at,
    receivedAt: dep.received_at,
    expiresAt: dep.expires_at,
    collectDeadlineAt: dep.collect_deadline_at,
    receivedByName: received?.display_name ?? null,
    confirmedByName: confirmed?.display_name ?? null,
    photoPaths: dep.photo_paths ?? [],
    confirmPhotoPaths: dep.confirm_photo_paths ?? [],
    notes: dep.notes,
    cancelReason: dep.cancel_reason,
    disposeReason: dep.dispose_reason,
    bottles: (bottleRows ?? []).map((b) => ({ id: b.id, bottleNo: b.bottle_no, remainingPercent: Number(b.remaining_percent), status: b.status })),
    events: eventRows.map((e) => ({
      id: e.id,
      action: e.action,
      payload: e.payload ?? {},
      createdAt: e.created_at,
      actorKind: e.actor_kind,
      actorName: e.actor?.display_name ?? null,
      actorRole: e.actor?.role ?? null,
    })),
    pendingWithdrawals: pendingRows.map((w) => ({
      id: w.id,
      bottleId: w.bottle_id,
      bottleNo: w.bottle?.bottle_no ?? null,
      type: w.type,
      tableLabel: w.table_label,
      createdAt: w.created_at,
      byCustomer: w.by_customer,
      requestedBy: w.requester?.display_name ?? null,
    })),
  }
}
