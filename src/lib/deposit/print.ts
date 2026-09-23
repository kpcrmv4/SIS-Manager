'use server'

import { callRpc, isUuid } from '@/lib/action'
import type { ActionResult } from '@/lib/errors'

export type PrintJobType = 'receipt' | 'label'

/** Queue a receipt/label print job for a deposit (RPC `queue_print`, P1 hardening migration). */
export async function queuePrint(depositId: string, type: PrintJobType, copies?: number): Promise<ActionResult<{ id: string }>> {
  if (!isUuid(depositId) || (type !== 'receipt' && type !== 'label')) return { ok: false, error: 'invalid' }
  return callRpc<{ id: string }>((sb) => sb.rpc('queue_print', { p_deposit: depositId, p_type: type, p_copies: copies }))
}
