import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getMessageQuota } from '@/lib/line/client'

/** R-063 · the automatic LINE messages the owner can switch, grouped by who receives them. */
export const LINE_NOTIFY_KINDS = {
  customer: ['deposit_confirmed', 'deposit_rejected', 'withdraw_completed', 'withdraw_rejected', 'booking_pending', 'booking_confirmed', 'booking_rejected', 'booking_cancelled', 'booking_reminder'],
  group: ['deposit_requested', 'withdrawal_requested', 'booking_new'],
} as const
export type LineNotifyKind = (typeof LINE_NOTIFY_KINDS)['customer'][number] | (typeof LINE_NOTIFY_KINDS)['group'][number]
export const ALL_LINE_NOTIFY_KINDS: readonly string[] = [...LINE_NOTIFY_KINDS.customer, ...LINE_NOTIFY_KINDS.group]

export type LineQuota = { state: 'ok'; limit: number | null; used: number } | { state: 'no_token' } | { state: 'error' }

/**
 * This month's push allowance of the branch's OA, read with its channel token (service role — the
 * token never leaves the server). Called only from the owner's settings page.
 */
export async function lineQuota(branchId: string): Promise<LineQuota> {
  const { data, error } = await getSupabaseAdmin().from('branch_line_secrets').select('channel_access_token').eq('branch_id', branchId).maybeSingle()
  if (error) return { state: 'error' }
  const token = data?.channel_access_token
  if (!token) return { state: 'no_token' }
  const q = await getMessageQuota(token)
  return q ? { state: 'ok', ...q } : { state: 'error' }
}
