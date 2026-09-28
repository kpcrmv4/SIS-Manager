import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { adminDb, fixtureIds } from './db'
import { PORT, required } from './env'
import { lineSignature } from '../../../src/lib/line/signature'

/**
 * P3-A fixtures: a local mock of the LINE Messaging API and the branch LINE settings the
 * specs need. The dev server must run with LINE_API_BASE=http://127.0.0.1:<PORT + 1000> so
 * every push / reply / profile call lands here — no real message ever leaves a test run.
 */

export const RUN = `E2EL-${Date.now().toString(36)}`
export const MOCK_PORT = PORT + 1000
export const TOKEN = `e2e-token-${RUN}-${randomBytes(12).toString('hex')}`
export const SECRET = randomBytes(16).toString('hex')
export const SECRET_B = randomBytes(16).toString('hex')
export const LIFF_ID = `${Date.now()}-E2E${randomBytes(4).toString('hex')}`

export type Recorded = { method: string; path: string; auth: string | null; retryKey: string | null; body: Record<string, unknown> | null }

export class MockLine {
  requests: Recorded[] = []
  /** status to answer a push with, per `to` (default 200) */
  pushStatus = new Map<string, number>()
  private server: Server | null = null

  async start() {
    this.server = createServer((req, res) => this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(MOCK_PORT, '127.0.0.1', () => resolve())
    })
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
    this.server = null
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: Record<string, unknown> | null = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = null
      }
      const path = req.url ?? ''
      this.requests.push({ method: req.method ?? '', path, auth: req.headers.authorization ?? null, retryKey: (req.headers['x-line-retry-key'] as string) ?? null, body })
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const profile = path.match(/^\/v2\/bot\/profile\/(U[0-9a-f]{32})$/)
      if (req.method === 'GET' && profile) return send(200, { userId: profile[1], displayName: `${RUN} LINE ${profile[1].slice(-4)}` })
      if (req.method === 'POST' && path === '/v2/bot/message/push') {
        const status = this.pushStatus.get(String(body?.to)) ?? 200
        return send(status, status === 200 ? { sentMessages: [{ id: '1' }] } : { message: `mock ${status}` })
      }
      if (req.method === 'POST' && path === '/v2/bot/message/reply') return send(200, { sentMessages: [{ id: '2' }] })
      if (req.method === 'GET' && path === '/v2/bot/info') return send(200, { userId: 'Ue2e', basicId: '@e2eshop', displayName: `${RUN} OA`, chatMode: 'bot' })
      return send(404, { message: 'mock: not found' })
    })
  }

  pushesTo(to: string) {
    return this.requests.filter((r) => r.path === '/v2/bot/message/push' && r.body?.to === to)
  }

  repliesTo(replyToken: string) {
    return this.requests.filter((r) => r.path === '/v2/bot/message/reply' && r.body?.replyToken === replyToken)
  }
}

export const lineUserId = () => `U${randomBytes(16).toString('hex')}`
export const groupId = () => `C${randomBytes(16).toString('hex')}`

/** Token + secret + LIFF id on fixture branch A, a secret (only) on branch B. */
export async function configureBranches() {
  const { branchA, branchB } = fixtureIds()
  const admin = adminDb()
  const { error } = await admin.from('branch_line_secrets').upsert(
    [
      { branch_id: branchA, channel_access_token: TOKEN, channel_secret: SECRET },
      { branch_id: branchB, channel_access_token: null, channel_secret: SECRET_B },
    ],
    { onConflict: 'branch_id' },
  )
  expect(error, error?.message).toBeNull()
  const { error: bErr } = await admin.from('branches').update({ liff_id: LIFF_ID, staff_group_id: null }).eq('id', branchA)
  expect(bErr, bErr?.message).toBeNull()
}

/** Everything a P3-A spec leaves behind, by fixture branch / run tag / the LINE ids it used. */
export async function cleanupLine(lineIds: string[]) {
  const { branchA, branchB } = fixtureIds()
  const admin = adminDb()
  await admin.from('line_outbox').delete().like('dedupe_key', `${RUN}%`)
  await admin.from('line_outbox').delete().in('branch_id', [branchA, branchB]).eq('kind', 'test')
  if (lineIds.length) {
    await admin.from('line_link_failures').delete().in('line_user_id', lineIds)
    await admin.from('line_outbox').delete().in('target', lineIds)
  }
  const { data: byName } = await admin.from('customers').select('id').like('display_name', `${RUN}%`).range(0, 999)
  const { data: byLine } = lineIds.length ? await admin.from('customers').select('id').in('line_user_id', lineIds).range(0, 999) : { data: [] }
  const ids = [...new Set([...(byName ?? []), ...(byLine ?? [])].map((c) => c.id))]
  if (ids.length) {
    await admin.from('deposits').update({ customer_id: null }).in('customer_id', ids)
    await admin.from('customers').delete().in('id', ids)
  }
  await admin.from('branch_line_secrets').delete().in('branch_id', [branchA, branchB])
  await admin.from('branches').update({ liff_id: null, line_channel_id: null, line_bot_user_id: null, staff_group_id: null }).in('id', [branchA, branchB])
}

/** POST a webhook body, signed with `secret` (null = no signature header). */
export async function postWebhook(request: APIRequestContext, code: string, body: unknown, secret: string | null) {
  const raw = JSON.stringify(body)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret) headers['x-line-signature'] = lineSignature(raw, secret)
  return request.post(`/api/line/webhook/${code}`, { data: raw, headers })
}

export function lineEvent(source: { type: 'user'; userId: string } | { type: 'group'; groupId: string; userId?: string }, extra: Record<string, unknown>) {
  return {
    mode: 'active',
    timestamp: Date.now(),
    webhookEventId: `01${randomBytes(12).toString('hex').toUpperCase()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: randomBytes(16).toString('hex'),
    source,
    ...extra,
  }
}

export const textEvent = (source: Parameters<typeof lineEvent>[0], text: string) => lineEvent(source, { type: 'message', message: { id: '1', type: 'text', text } })

export async function runCron(request: APIRequestContext) {
  const res = await request.post('/api/cron/line-dispatch', { headers: { authorization: `Bearer ${required('CRON_SECRET')}` } })
  expect(res.status()).toBe(200)
  return res.json()
}

/** Run the dispatcher until the outbox row leaves queued/sending (other runs may have a backlog ahead of it). */
export async function dispatchUntilDone(request: APIRequestContext, dedupeKey: string) {
  for (let i = 0; i < 6; i++) {
    await runCron(request)
    const { data } = await adminDb().from('line_outbox').select('status').eq('dedupe_key', dedupeKey).single()
    if (data && data.status !== 'queued' && data.status !== 'sending') return
  }
}
