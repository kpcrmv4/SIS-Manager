'use server'

import { headers } from 'next/headers'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getActorState } from '@/lib/auth/actor'
import { dispatchPush } from './dispatch'

export type PushResult = { ok: true } | { ok: false; error: 'invalid' | 'unauthenticated' | 'failed' }

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/

// the server POSTs to this URL on every notification — only real browser push services
// (Chrome/Edge FCM, Firefox autopush, Windows WNS, Safari/Apple), never an arbitrary host
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^web\.push\.apple\.com$/]
function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

/**
 * Save this browser's push subscription for the signed-in staff member (own row, RLS).
 * An endpoint is unique: if the same browser was subscribed under another account
 * (shared phone), that old row is removed first — holding the endpoint proves the
 * device, and the previous user must not keep receiving this device's pushes.
 */
export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<PushResult> {
  const state = await getActorState()
  if (state.status !== 'ok') return { ok: false, error: 'unauthenticated' }
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : ''
  const p256dh = sub?.keys?.p256dh ?? ''
  const auth = sub?.keys?.auth ?? ''
  if (!isPushEndpoint(endpoint) || endpoint.length > 1000 || !B64URL.test(p256dh) || !B64URL.test(auth) || p256dh.length > 200 || auth.length > 100) {
    return { ok: false, error: 'invalid' }
  }
  const userAgent = ((await headers()).get('user-agent') ?? '').slice(0, 300)
  const sb = await getSupabaseServer()
  const row = { user_id: state.actor.id, endpoint, p256dh, auth, user_agent: userAgent }
  let { error } = await sb.from('push_subscriptions').insert(row)
  if (error?.code === '23505') {
    const { error: delErr } = await getSupabaseAdmin().from('push_subscriptions').delete().eq('endpoint', endpoint)
    if (delErr) return { ok: false, error: 'failed' }
    ;({ error } = await sb.from('push_subscriptions').insert(row))
  }
  return error ? { ok: false, error: 'failed' } : { ok: true }
}

export async function deletePushSubscription(endpoint: string): Promise<PushResult> {
  const state = await getActorState()
  if (state.status !== 'ok') return { ok: false, error: 'unauthenticated' }
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return { ok: false, error: 'invalid' }
  const { error } = await (await getSupabaseServer()).from('push_subscriptions').delete().eq('endpoint', endpoint)
  return error ? { ok: false, error: 'failed' } : { ok: true }
}

export type TestPushResult = { ok: true } | { ok: false; error: 'unauthenticated' | 'no_device' | 'too_soon' | 'not_configured' | 'failed' }

const TEST_GAP_MS = 15_000

/**
 * /me ส่งแจ้งเตือนทดสอบ (R-042): one notification of kind `test` to the signed-in user's own
 * devices, sent at once. It is stored read — it proves the device, it is not work — so the bell
 * count and the icon count leave it out. One every 15 seconds.
 */
export async function sendTestPush(): Promise<TestPushResult> {
  const state = await getActorState()
  if (state.status !== 'ok') return { ok: false, error: 'unauthenticated' }
  const userId = state.actor.id
  const admin = getSupabaseAdmin()
  const since = new Date(Date.now() - TEST_GAP_MS).toISOString()
  const [devices, recent] = await Promise.all([
    admin.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'test').gte('created_at', since),
  ])
  if (devices.error || recent.error) return { ok: false, error: 'failed' }
  if (!devices.count) return { ok: false, error: 'no_device' }
  if (recent.count) return { ok: false, error: 'too_soon' }
  const { error } = await admin.from('notifications').insert({ user_id: userId, kind: 'test', link: '/me', read_at: new Date().toISOString() })
  if (error) return { ok: false, error: 'failed' }
  try {
    const sent = await dispatchPush()
    return sent.skipped === 'vapid_not_configured' ? { ok: false, error: 'not_configured' } : { ok: true }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
