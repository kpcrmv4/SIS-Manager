import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'

export type BranchSettings = {
  id: string
  code: string
  name: string
  depositDays: number
  expiryNoticeDays: number
  withdrawalBlockedDays: string[]
  opensAt: string
  closesAt: string
}

/** The deposit-relevant branch settings — expiry length, blocked withdrawal nights, opening hours. */
export async function getBranchSettings(branchId: string): Promise<BranchSettings | null> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('branches')
    .select('id, code, name, deposit_days, expiry_notice_days, withdrawal_blocked_days, opens_at, closes_at')
    .eq('id', branchId)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: data.id,
    code: data.code,
    name: data.name,
    depositDays: data.deposit_days,
    expiryNoticeDays: data.expiry_notice_days,
    withdrawalBlockedDays: data.withdrawal_blocked_days,
    opensAt: data.opens_at,
    closesAt: data.closes_at,
  }
}

/** Mon..Sun index (matches lib/date weekdayIndex) → the day-name strings branches.withdrawal_blocked_days uses. */
export const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
