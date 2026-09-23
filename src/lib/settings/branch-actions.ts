'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { cleanText, isUuid } from '@/lib/action'
import type { Database } from '@/types/database'

type BranchUpdate = Database['public']['Tables']['branches']['Update']

/** Owner CRUD for branches — session client, RLS restricts writes to owner. */
export type SettingsResult<T = undefined> = { ok: true; data: T } | { ok: false; error: 'invalid' | 'forbidden' | 'code_taken' }

function touched() {
  revalidatePath('/settings/branch')
  revalidatePath('/settings/users')
}

const CODE_RE = /^[A-Z]{2,5}$/
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export async function createBranch(code: string, name: string): Promise<SettingsResult<{ id: string }>> {
  const cleanCode = code.trim().toUpperCase()
  const cleanName = cleanText(name, 120)
  if (!CODE_RE.test(cleanCode) || !cleanName) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  // No .select() on the insert itself: branches_select's my_branch_ids() scans the whole
  // branches table from inside the RLS check, and does not see the row this same INSERT
  // command is still creating, so `INSERT ... RETURNING` 42501s even though the write
  // itself is allowed. A separate follow-up SELECT (its own statement) sees it fine.
  const { error } = await sb.from('branches').insert({ code: cleanCode, name: cleanName })
  if (error) return { ok: false, error: error.code === '23505' ? 'code_taken' : 'invalid' }
  const { data } = await sb.from('branches').select('id').eq('code', cleanCode).single()
  touched()
  return { ok: true, data: { id: data?.id ?? '' } }
}

export type BranchDetailInput = {
  name?: string
  depositDays?: number
  expiryNoticeDays?: number
  withdrawalBlockedDays?: (typeof WEEKDAYS)[number][]
  opensAt?: string
  closesAt?: string
  receiptHeader?: string
  receiptFooter?: string
  receiptCopies?: number
  active?: boolean
}

export async function updateBranch(branchId: string, patch: BranchDetailInput): Promise<SettingsResult> {
  if (!isUuid(branchId)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const row: BranchUpdate = {}
  if (patch.name !== undefined) {
    const clean = cleanText(patch.name, 120)
    if (!clean) return { ok: false, error: 'invalid' }
    row.name = clean
  }
  if (patch.depositDays !== undefined) row.deposit_days = Math.trunc(patch.depositDays)
  if (patch.expiryNoticeDays !== undefined) row.expiry_notice_days = Math.trunc(patch.expiryNoticeDays)
  if (patch.withdrawalBlockedDays !== undefined) {
    if (!patch.withdrawalBlockedDays.every((d) => WEEKDAYS.includes(d))) return { ok: false, error: 'invalid' }
    row.withdrawal_blocked_days = patch.withdrawalBlockedDays
  }
  if (patch.opensAt !== undefined) row.opens_at = patch.opensAt
  if (patch.closesAt !== undefined) row.closes_at = patch.closesAt
  if (patch.active !== undefined) row.active = patch.active

  if (patch.receiptHeader !== undefined || patch.receiptFooter !== undefined || patch.receiptCopies !== undefined) {
    const { data: current } = await sb.from('branches').select('receipt_settings').eq('id', branchId).maybeSingle()
    const existing = (current?.receipt_settings ?? {}) as Record<string, unknown>
    row.receipt_settings = {
      ...existing,
      ...(patch.receiptHeader !== undefined ? { header: cleanText(patch.receiptHeader, 200) ?? '' } : {}),
      ...(patch.receiptFooter !== undefined ? { footer: cleanText(patch.receiptFooter, 200) ?? '' } : {}),
      ...(patch.receiptCopies !== undefined ? { copies: Math.max(1, Math.trunc(patch.receiptCopies)) } : {}),
    }
  }

  const { data, error } = await sb.from('branches').update(row).eq('id', branchId).select('id').maybeSingle()
  if (error) return { ok: false, error: 'invalid' }
  if (!data) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: undefined }
}
