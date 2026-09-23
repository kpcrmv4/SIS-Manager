import { randomBytes } from 'node:crypto'
import { expect } from '@playwright/test'
import { adminDb, dbAs } from './db'
import type { FixtureRole } from './users'
import { RUN, deposit } from './deposits'

/** A pending withdrawal request on an in-store deposit — request_withdrawal inserts one row per bottle. */
export async function requestWithdrawal(depositId: string, bottleIds: string[], type: 'in_store' | 'take_home', role: FixtureRole = 'staff') {
  const { data, error } = await dbAs(role).rpc('request_withdrawal', { p_deposit: depositId, p_bottle_ids: bottleIds, p_type: type })
  expect(error, error?.message).toBeNull()
  return data as { deposit_id: string; withdrawal_ids: string[] }
}

/** Force a deposit into `expired` (service role — bypasses the RPC path the cron job normally uses). */
export async function forceExpired(depositId: string) {
  const past = new Date(Date.now() - 3 * 86400000).toISOString()
  const { error } = await adminDb().from('deposits').update({ status: 'expired', expires_at: past, collect_deadline_at: past }).eq('id', depositId)
  expect(error, error?.message).toBeNull()
}

/** A LINE deposit request (status `requested`) — the only way to create one is the service-role RPC. */
export async function createLineRequest(branchId: string, opts: { qty?: number; item?: string } = {}) {
  const line = `U${randomBytes(16).toString('hex')}`
  const { data: customer, error: custError } = await adminDb()
    .from('customers')
    .upsert({ line_user_id: line, display_name: `${RUN} LINE`, locale: 'th' }, { onConflict: 'line_user_id' })
    .select('id')
    .single()
  expect(custError, custError?.message).toBeNull()

  const { data, error } = await adminDb().rpc('customer_request_deposit', {
    p_branch: branchId,
    p_customer_id: customer!.id,
    p_customer_name: `${RUN} ลูกค้า LINE`,
    p_item_name: opts.item ?? 'Hennessy VSOP',
    p_quantity: opts.qty ?? 2,
    p_terms_version: 'v1',
    p_terms_locale: 'th',
  })
  expect(error, error?.message).toBeNull()
  return data as { id: string; code: string }
}

export async function bottleIds(depositId: string): Promise<string[]> {
  const { data } = await adminDb().from('deposit_bottles').select('id, bottle_no').eq('deposit_id', depositId).order('bottle_no')
  return (data ?? []).map((b) => b.id)
}

export { deposit }
