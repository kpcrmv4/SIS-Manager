import 'server-only'
import webpush from 'web-push'
import { getTranslations } from 'next-intl/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { deliver, type PushMessage, type PushRow } from './core'

const KINDS = ['deposit_received', 'deposit_withdrawal_requested', 'deposit_requested', 'booking_pending']

let configured = false
function configure(): boolean {
  if (configured) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subject) return false
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

/**
 * Claim unpushed notifications (claim_push, service role) and send one web push per
 * subscription, text from the staff catalog in the user's locale (`bell.kinds.*`).
 * Called by /api/cron/push-dispatch; safe to call often — a claim is taken once.
 */
export async function dispatchPush(limit = 50): Promise<{ sent: number; removed: number; failed: number; skipped?: string }> {
  if (!configure()) return { sent: 0, removed: 0, failed: 0, skipped: 'vapid_not_configured' }
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.rpc('claim_push', { p_limit: limit })
  if (error) throw new Error(`claim_push: ${error.code ?? error.message}`)
  const rows = (data ?? []) as PushRow[]
  if (!rows.length) return { sent: 0, removed: 0, failed: 0 }

  const userIds = [...new Set(rows.map((r) => r.user_id))]
  const { data: profiles, error: pErr } = await admin.from('profiles').select('id, locale').in('id', userIds)
  if (pErr) throw new Error(`push profiles: ${pErr.code ?? pErr.message}`)
  const localeOf = new Map((profiles ?? []).map((p) => [p.id, p.locale === 'en' ? 'en' : 'th']))
  const [tTh, tEn] = await Promise.all([getTranslations({ locale: 'th', namespace: 'bell' }), getTranslations({ locale: 'en', namespace: 'bell' })])

  const render = (row: PushRow): PushMessage => {
    const t = localeOf.get(row.user_id) === 'en' ? tEn : tTh
    const p = row.payload ?? {}
    const v = (k: string) => (p[k] == null ? '' : String(p[k]))
    const kind = KINDS.includes(row.kind) ? row.kind : 'other'
    const body = t(`kinds.${kind}` as never, { item: v('item'), customer: v('customer'), table: v('table') || '—', name: v('name'), party: v('party'), time: v('time'), code: v('code') } as never)
    return { title: t('title'), body, url: row.link?.startsWith('/') ? row.link : '/', tag: row.notification_id }
  }

  return deliver(
    rows,
    render,
    (sub, message) => webpush.sendNotification(sub, JSON.stringify(message), { TTL: 3600 }),
    async (id) => {
      const { error: delErr } = await admin.from('push_subscriptions').delete().eq('id', id)
      if (delErr) throw new Error(`push prune: ${delErr.code ?? delErr.message}`)
    },
  )
}
