'use server'

import { revalidatePath } from 'next/cache'
import { callRpc, isUuid } from '@/lib/action'
import type { ActionResult } from '@/lib/errors'
import { CUSTOMER_KEY } from './view'

/**
 * A customer VIP on or off at one branch (R-048, bar / owner — the RPC decides). The branch is the
 * one the page was rendered for, so a branch switched in another tab can't take the change.
 */
export async function setCustomerVip(
  branchId: string,
  key: string,
  vip: boolean,
): Promise<ActionResult<{ key: string; is_vip: boolean; deposits: number }>> {
  if (!isUuid(branchId) || typeof key !== 'string' || !CUSTOMER_KEY.test(key) || typeof vip !== 'boolean') return { ok: false, error: 'invalid' }
  const res = await callRpc<{ key: string; is_vip: boolean; deposits: number }>((sb) =>
    sb.rpc('set_customer_vip', { p_branch: branchId, p_key: key, p_vip: vip }),
  )
  if (res.ok) {
    revalidatePath('/customers')
    revalidatePath(`/customers/${res.data.key}`)
    revalidatePath('/deposits')
    revalidatePath('/tonight')
  }
  return res
}
