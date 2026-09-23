import 'server-only'
import type { LineMessage } from './flex'

/**
 * A minimal LINE Messaging API client (fetch, no SDK). The base URL is LINE_API_BASE so
 * the E2E specs can point every call at a local mock — no real message leaves a test run.
 */

export function lineApiBase(): string {
  return (process.env.LINE_API_BASE || 'https://api.line.me').replace(/\/+$/, '')
}

/** status 0 = the request never got an HTTP answer (DNS, refused, timeout). */
export type LineCallResult = { ok: true; status: number; body: unknown } | { ok: false; status: number; message: string }

async function lineFetch(path: string, token: string, init: { method: 'GET' | 'POST'; body?: unknown; retryKey?: string }): Promise<LineCallResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.retryKey) headers['X-Line-Retry-Key'] = init.retryKey
  let res: Response
  try {
    res = await fetch(`${lineApiBase()}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.name : 'network' }
  }
  const raw = await res.text().catch(() => '')
  let body: unknown = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = raw
  }
  if (res.ok) return { ok: true, status: res.status, body }
  const b = (body && typeof body === 'object' ? body : {}) as { message?: string; details?: { message?: string; property?: string }[] }
  const detail = b.details?.[0] ? ` (${b.details[0].property ?? ''} ${b.details[0].message ?? ''})`.replace(/\s+\)/, ')') : ''
  return { ok: false, status: res.status, message: `${b.message ?? res.statusText ?? 'error'}${detail}`.slice(0, 400) }
}

/** Push to a user / group id. `retryKey` (the outbox row id) makes a retried push idempotent: LINE answers 409 for a key it already accepted. */
export function pushMessage(token: string, to: string, messages: LineMessage[], retryKey?: string): Promise<LineCallResult> {
  return lineFetch('/v2/bot/message/push', token, { method: 'POST', body: { to, messages }, retryKey })
}

export function replyMessage(token: string, replyToken: string, messages: LineMessage[]): Promise<LineCallResult> {
  return lineFetch('/v2/bot/message/reply', token, { method: 'POST', body: { replyToken, messages } })
}

export type LineProfile = { displayName: string | null; pictureUrl: string | null; language: string | null }

/** GET /v2/bot/profile/{userId} — null when LINE does not answer or the user blocked the OA. */
export async function getBotProfile(token: string, userId: string): Promise<LineProfile | null> {
  const r = await lineFetch(`/v2/bot/profile/${encodeURIComponent(userId)}`, token, { method: 'GET' })
  if (!r.ok || !r.body || typeof r.body !== 'object') return null
  const p = r.body as { displayName?: unknown; pictureUrl?: unknown; language?: unknown }
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  return { displayName: str(p.displayName, 120), pictureUrl: str(p.pictureUrl, 500), language: str(p.language, 20) }
}
