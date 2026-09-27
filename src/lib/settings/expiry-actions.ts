'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/action'
import { EXPIRY_LOCALES, TEMPLATE_MAX, cleanReminderDays, unknownVariables, type ExpiryLocale } from '@/lib/line/expiry-template'
import { expiryReminderDefaults } from '@/lib/line/catalog'

export type ExpiryNoticeInput = {
  /** the reminders before the expiry date */
  enabled: boolean
  /** the message once the collection deadline has passed (R-064) */
  expiredEnabled: boolean
  /** days before the expiry date — 1 to 3 of them, 1–90 each */
  days: number[]
  /** HH:MM, Bangkok wall clock */
  time: string
  /** per LIFF language; empty, or the default wording, means "use the default" */
  templates: Partial<Record<ExpiryLocale, string>>
}

export type ExpiryNoticeResult = { ok: true } | { ok: false; error: 'invalid' | 'forbidden' | 'days' | 'time' | 'template' }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * /settings/branch — แจ้งเตือนหมดอายุทาง LINE (R-044). Session client: RLS lets only the owner
 * write a branch. A wording equal to the default is not stored, so the default can improve later.
 */
export async function saveExpiryNotices(branchId: string, input: ExpiryNoticeInput): Promise<ExpiryNoticeResult> {
  if (!isUuid(branchId) || typeof input?.enabled !== 'boolean' || typeof input.expiredEnabled !== 'boolean') return { ok: false, error: 'invalid' }
  const days = cleanReminderDays(input.days)
  if (!days) return { ok: false, error: 'days' }
  if (typeof input.time !== 'string' || !TIME_RE.test(input.time)) return { ok: false, error: 'time' }

  const defaults = expiryReminderDefaults()
  const templates: Partial<Record<ExpiryLocale, string>> = {}
  for (const [lang, raw] of Object.entries(input.templates ?? {})) {
    if (!(EXPIRY_LOCALES as readonly string[]).includes(lang) || typeof raw !== 'string') return { ok: false, error: 'template' }
    const text = raw.replace(/\r\n?/g, '\n').trim()
    if (Array.from(text).length > TEMPLATE_MAX || unknownVariables(text).length) return { ok: false, error: 'template' }
    if (text && text !== defaults[lang as ExpiryLocale].trim()) templates[lang as ExpiryLocale] = text
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('branches')
    .update({ expiry_reminders_enabled: input.enabled, expired_notice_enabled: input.expiredEnabled, expiry_reminder_days: days, expiry_reminder_time: input.time, expiry_reminder_templates: templates })
    .eq('id', branchId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: 'invalid' }
  if (!data) return { ok: false, error: 'forbidden' }
  revalidatePath('/settings/branch')
  return { ok: true }
}
