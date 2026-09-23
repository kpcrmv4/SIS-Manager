import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { customerLocaleFrom } from '@/lib/i18n/config'
import { getBotProfile, replyMessage } from './client'
import { renderMessage, type RenderContext } from './render'
import { matchKeyword } from './keywords'

/**
 * LINE webhook events for one branch OA (P3-A3). Runs only after the route verified the
 * signature. Every action here is idempotent, so a redelivered event is harmless even when
 * the in-process dedupe below misses it (another server instance, a restart):
 *   - customer upsert: found by line_user_id, inserted once (unique), else re-read
 *   - link: line_link_attempt on a deposit already linked to THIS customer is ok, no new event
 *   - group bind: the code is single-use (cleared on success)
 */

export type WebhookBranch = { id: string; code: string; name: string; liff_id: string | null }

type Source = { type?: string; userId?: string; groupId?: string; roomId?: string }
export type LineEvent = {
  type?: string
  webhookEventId?: string
  replyToken?: string
  source?: Source
  message?: { type?: string; text?: string }
  deliveryContext?: { isRedelivery?: boolean }
}

const USER_ID = /^U[0-9a-f]{32}$/
const DEP_CODE = /^DEP-?[A-Z]{2,5}-?[A-Z0-9]{5}$/
const LINK_CODE = /^[A-HJ-NP-Z2-9]{6}$/
const LINK_TOKEN = /^[0-9A-F]{32}$/
// staff-group bind code: SIS- + 8 chars of the link alphabet (CSPRNG, private.random_code)
const BIND_CODE = /^SIS-[A-HJ-NP-Z2-9]{8}$/

// ── best-effort in-process dedupe on webhookEventId ─────────────────────
const SEEN_TTL_MS = 60 * 60 * 1000
const SEEN_MAX = 5000
const seen: Map<string, number> = ((globalThis as { __sisLineSeen?: Map<string, number> }).__sisLineSeen ??= new Map())

function claimEvent(id: string | undefined): boolean {
  if (!id) return true
  const now = Date.now()
  const at = seen.get(id)
  if (at && now - at < SEEN_TTL_MS) return false
  if (seen.size >= SEEN_MAX) {
    for (const [k, t] of seen) if (now - t >= SEEN_TTL_MS || seen.size >= SEEN_MAX) seen.delete(k)
  }
  seen.set(id, now)
  return true
}

/** "  abc 23x " → "ABC23X" */
export function normaliseCode(text: string): string {
  return text.trim().replace(/\s+/g, '').toUpperCase()
}

type Customer = { id: string; locale: string }

async function ensureCustomer(token: string, userId: string, refreshName: boolean): Promise<Customer | null> {
  const admin = getSupabaseAdmin()
  const { data: found, error } = await admin.from('customers').select('id, locale, display_name').eq('line_user_id', userId).maybeSingle()
  if (error) return null
  if (found && !refreshName) return found
  const profile = await getBotProfile(token, userId)
  if (found) {
    if (profile?.displayName && profile.displayName !== found.display_name) {
      // cosmetic: a failed name refresh does not stop the event
      const { error: updateError } = await admin.from('customers').update({ display_name: profile.displayName, picture_url: profile.pictureUrl }).eq('id', found.id)
      void updateError
    }
    return found
  }
  const { data: created, error: insertError } = await admin
    .from('customers')
    .insert({ line_user_id: userId, display_name: profile?.displayName ?? null, picture_url: profile?.pictureUrl ?? null, locale: customerLocaleFrom(profile?.language) })
    .select('id, locale')
    .single()
  if (created) return created
  if (insertError?.code !== '23505') return null
  // a concurrent delivery inserted it first
  const { data: again, error: againError } = await admin.from('customers').select('id, locale').eq('line_user_id', userId).maybeSingle()
  return againError ? null : again
}

async function reply(token: string, replyToken: string | undefined, kind: string, locale: string, payload: unknown, ctx: RenderContext) {
  if (!replyToken) return
  const message = renderMessage(kind, locale, payload, ctx)
  if (message) await replyMessage(token, replyToken, [message])
}

async function handleEvent(branch: WebhookBranch, token: string, ev: LineEvent) {
  const ctx: RenderContext = { liffId: branch.liff_id, branchName: branch.name, appBaseUrl: process.env.APP_BASE_URL || null }
  const src = ev.source ?? {}
  const admin = getSupabaseAdmin()

  if (ev.type === 'follow' && src.type === 'user' && src.userId && USER_ID.test(src.userId)) {
    const customer = await ensureCustomer(token, src.userId, true)
    await reply(token, ev.replyToken, 'welcome', customer?.locale ?? 'th', {}, ctx)
    return
  }

  if (ev.type !== 'message' || ev.message?.type !== 'text' || typeof ev.message.text !== 'string') return
  if (ev.message.text.length > 200) return
  const text = normaliseCode(ev.message.text)

  if (src.type === 'group' || src.type === 'room') {
    const groupId = src.type === 'group' ? src.groupId : src.roomId
    if (!groupId || !BIND_CODE.test(text)) return
    const { data, error } = await admin.rpc('bind_staff_group', { p_branch: branch.id, p_code: text, p_group_id: groupId })
    if (!error && data === true) await reply(token, ev.replyToken, 'group_bound', 'th', {}, ctx)
    return
  }

  if (src.type !== 'user' || !src.userId || !USER_ID.test(src.userId)) return

  // ฝาก / เบิก / จองโต๊ะ / เมนู … → a card with the matching LIFF page
  const keyword = matchKeyword(ev.message.text)
  if (keyword) {
    const customer = await ensureCustomer(token, src.userId, false)
    await reply(token, ev.replyToken, keyword, customer?.locale ?? 'th', {}, ctx)
    return
  }

  const isDep = DEP_CODE.test(text)
  const isRef = LINK_CODE.test(text) || LINK_TOKEN.test(text)
  if (!isDep && !isRef) return // ordinary chat — no reply

  const customer = await ensureCustomer(token, src.userId, false)
  if (!customer) return
  if (isDep) {
    await reply(token, ev.replyToken, 'use_receipt_code', customer.locale, {}, ctx)
    return
  }
  const { data, error } = await admin.rpc('line_link_attempt', { p_branch: branch.id, p_customer_id: customer.id, p_ref: text })
  if (error || !data || typeof data !== 'object') return
  const res = data as { ok?: boolean; error?: string; locale?: string }
  if (res.ok) {
    await reply(token, ev.replyToken, 'linked', res.locale ?? customer.locale, res, ctx)
    return
  }
  // NOT_FOUND / NOT_YOURS / BAD_STATE all read the same — never hint that a code exists
  await reply(token, ev.replyToken, res.error === 'THROTTLED' ? 'throttled' : 'link_not_found', customer.locale, {}, ctx)
}

/** Handle every event; one failing event never fails the others or the HTTP answer. */
export async function handleWebhookEvents(branch: WebhookBranch, token: string | null, events: LineEvent[]): Promise<void> {
  if (!token) return
  await Promise.allSettled(
    events.slice(0, 100).map(async (ev) => {
      if (!claimEvent(ev.webhookEventId)) return
      try {
        await handleEvent(branch, token, ev)
      } catch {
        // let a redelivery try again
        if (ev.webhookEventId) seen.delete(ev.webhookEventId)
      }
    }),
  )
}
