'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/action'

const KINDS = [
  'deposit_confirmed', 'deposit_rejected', 'withdraw_completed', 'withdraw_rejected',
  'booking_pending', 'booking_confirmed', 'booking_rejected', 'booking_cancelled', 'booking_reminder',
  'deposit_requested', 'withdrawal_requested', 'booking_new',
]

/**
 * R-063 · switch one automatic LINE message of a branch on or off. Session client: RLS lets only
 * the owner write a branch (no row back = not allowed); the database's check keeps the list to known kinds.
 */
export async function setLineNotify(branchId: string, kind: string, on: boolean): Promise<{ ok: true; off: string[] } | { ok: false; error: 'invalid' | 'forbidden' }> {
  if (!isUuid(branchId) || !KINDS.includes(kind) || typeof on !== 'boolean') return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const { data: cur, error: readError } = await sb.from('branches').select('line_notify_off').eq('id', branchId).maybeSingle()
  if (readError) return { ok: false, error: 'invalid' }
  if (!cur) return { ok: false, error: 'forbidden' }
  const off = on ? cur.line_notify_off.filter((k) => k !== kind) : [...new Set([...cur.line_notify_off, kind])]
  const { data, error } = await sb.from('branches').update({ line_notify_off: off }).eq('id', branchId).select('line_notify_off').maybeSingle()
  if (error) return { ok: false, error: 'invalid' }
  if (!data) return { ok: false, error: 'forbidden' }
  revalidatePath('/settings/branch')
  return { ok: true, off: data.line_notify_off }
}
