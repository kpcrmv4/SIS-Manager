'use server'

import { getSupabaseServer } from '@/lib/supabase/server'
import { dbErrorCode, type ActionResult } from '@/lib/errors'
import { isUuid } from '@/lib/action'
import type { DepositStatus } from './format'

export type DepositScanSummary = {
  id: string
  code: string
  itemName: string
  customerName: string
  status: DepositStatus
  isVip: boolean
  remainingQty: number
  remainingPercent: number
  expiresAt: string | null
}

/** The lightweight read the scan result card needs — RLS already limits it to the caller's branches. */
export async function getDepositScanSummary(depositId: string): Promise<ActionResult<DepositScanSummary>> {
  if (!isUuid(depositId)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const { data: claims } = await sb.auth.getClaims()
  if (!claims?.claims?.sub) return { ok: false, error: 'unauthenticated' }
  const { data, error } = await sb
    .from('deposits')
    .select('id, code, item_name, customer_name, status, is_vip, remaining_qty, remaining_percent, expires_at')
    .eq('id', depositId)
    .maybeSingle()
  if (error) return { ok: false, error: dbErrorCode(error) }
  if (!data) return { ok: false, error: 'NOT_FOUND' }
  return {
    ok: true,
    data: {
      id: data.id,
      code: data.code,
      itemName: data.item_name,
      customerName: data.customer_name,
      status: data.status,
      isVip: data.is_vip,
      remainingQty: data.remaining_qty,
      remainingPercent: Number(data.remaining_percent),
      expiresAt: data.expires_at,
    },
  }
}
