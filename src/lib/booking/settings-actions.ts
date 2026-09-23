'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { cleanText, isUuid } from '@/lib/action'

/**
 * Owner writes to booking_settings / booking_blackouts — through the signed-in
 * session client (RLS already restricts writes to `owner`, CLAUDE.md P2-B3).
 * These are not RPCs, so they get their own small result type rather than
 * reaching into lib/errors' RPC-shaped ActionResult.
 */
export type SettingsResult<T = undefined> = { ok: true; data: T } | { ok: false; error: 'invalid' | 'forbidden' }

function touched() {
  revalidatePath('/settings/booking')
  revalidatePath('/bookings')
}

export type BookingSettingsInput = {
  branchId: string
  lineEnabled: boolean
  autoConfirm: boolean
  advanceDays: number
  cutoffTime: string
  slotStart: string
  slotEnd: string
  slotMinutes: number
  maxBookingsPerNight: number | null
  partyMin: number
  partyMax: number
  noShowMinutes: number
  customerCancelHours: number
  closedWeekdays: number[]
}

export async function saveBookingSettings(input: BookingSettingsInput): Promise<SettingsResult> {
  if (!isUuid(input.branchId)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('booking_settings')
    .update({
      line_enabled: input.lineEnabled,
      auto_confirm: input.autoConfirm,
      advance_days: Math.trunc(input.advanceDays),
      cutoff_time: input.cutoffTime,
      slot_start: input.slotStart,
      slot_end: input.slotEnd,
      slot_minutes: Math.trunc(input.slotMinutes),
      max_bookings_per_night: input.maxBookingsPerNight === null ? null : Math.trunc(input.maxBookingsPerNight),
      party_min: Math.trunc(input.partyMin),
      party_max: Math.trunc(input.partyMax),
      no_show_minutes: Math.trunc(input.noShowMinutes),
      customer_cancel_hours: Math.trunc(input.customerCancelHours),
      closed_weekdays: input.closedWeekdays,
    })
    .eq('branch_id', input.branchId)
    .select('branch_id')
    .maybeSingle()
  if (error) return { ok: false, error: 'invalid' }
  if (!data) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: undefined }
}

export async function toggleBlackout(branchId: string, night: string, reason?: string): Promise<SettingsResult<{ action: 'added' | 'removed' }>> {
  if (!isUuid(branchId) || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const { data: existing, error: findError } = await sb.from('booking_blackouts').select('id').eq('branch_id', branchId).eq('night', night).maybeSingle()
  if (findError) return { ok: false, error: 'invalid' }
  if (existing) {
    const { error } = await sb.from('booking_blackouts').delete().eq('id', existing.id)
    if (error) return { ok: false, error: 'invalid' }
    touched()
    return { ok: true, data: { action: 'removed' } }
  }
  const { error } = await sb.from('booking_blackouts').insert({ branch_id: branchId, night, reason: cleanText(reason, 200) ?? null })
  if (error) return { ok: false, error: 'invalid' }
  touched()
  return { ok: true, data: { action: 'added' } }
}
