import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { PORT } from './env'

/**
 * R-071: a local stand-in for Anthropic's Messages and Models APIs, so the assistant's real code
 * path — streaming, the tool loop, the cards — runs in E2E without a key or a bill. The dev server
 * runs with AI_API_BASE=http://127.0.0.1:<PORT + 1001> (playwright.config.ts).
 *
 * Scripted by the question text:
 *   "TOOL <name> <json>"  → one tool_use of that tool with that input; after its result, a short text
 *   anything else          → a text answer echoing the question
 * A key containing "reject" gets 401, as Anthropic answers a bad key.
 */
export const AI_MOCK_PORT = PORT + 1001

type Block = { type: string; text?: string; content?: unknown; name?: string }
type Msg = { role: string; content: string | Block[] }
export type AiRequest = { path: string; key: string; body: { model?: string; tools?: { name: string }[]; messages?: Msg[] } }

export class MockAnthropic {
  requests: AiRequest[] = []
  private server: Server | null = null

  async start() {
    this.server = createServer((req, res) => this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(AI_MOCK_PORT, '127.0.0.1', () => resolve())
    })
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
    this.server = null
  }

  /** the tool_result texts the app sent back, newest last */
  toolResults(): string[] {
    return this.requests.flatMap((r) =>
      (r.body.messages ?? []).flatMap((m) =>
        Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result').map((b) => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content))) : [],
      ),
    )
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const key = String(req.headers['x-api-key'] ?? '')
      const path = (req.url ?? '').split('?')[0]
      let body: AiRequest['body'] = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        body = {}
      }
      this.requests.push({ path, key, body })
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      if (key.includes('reject')) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })

      if (req.method === 'GET' && path === '/v1/models') {
        const data = ['claude-opus-5', 'claude-sonnet-5', 'claude-mock-next'].map((id) => ({ type: 'model', id, display_name: `Mock ${id}`, created_at: '2026-01-01T00:00:00Z' }))
        return json(200, { data, has_more: false, first_id: data[0].id, last_id: data[data.length - 1].id })
      }
      const model = path.match(/^\/v1\/models\/(.+)$/)
      if (req.method === 'GET' && model) {
        const id = decodeURIComponent(model[1])
        if (!id.startsWith('claude-')) return json(404, { type: 'error', error: { type: 'not_found_error', message: 'model not found' } })
        return json(200, { type: 'model', id, display_name: `Mock ${id}`, created_at: '2026-01-01T00:00:00Z' })
      }
      if (req.method !== 'POST' || path !== '/v1/messages') return json(404, { type: 'error', error: { type: 'not_found_error', message: path } })

      const msgs = body.messages ?? []
      const last = msgs[msgs.length - 1]
      const blocks: Block[] = typeof last?.content === 'string' ? [{ type: 'text', text: last.content }] : (last?.content ?? [])
      const hasResult = blocks.some((b) => b.type === 'tool_result')
      const question = [...blocks].reverse().find((b) => b.type === 'text')?.text ?? ''
      const tool = /^TOOL (\w+) (\{[\s\S]*\})\s*$/.exec(question.trim())

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const ev = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      ev('message_start', {
        message: { id: `msg_${this.requests.length}`, type: 'message', role: 'assistant', model: body.model ?? 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } },
      })
      let stop = 'end_turn'
      if (tool && !hasResult) {
        ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${this.requests.length}`, name: tool[1], input: {} } })
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: tool[2] } })
        ev('content_block_stop', { index: 0 })
        stop = 'tool_use'
      } else {
        const text = hasResult ? 'MOCK: เตรียมการ์ดให้แล้ว' : `MOCK: ${question.slice(0, 60)}`
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
        ev('content_block_stop', { index: 0 })
      }
      ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 8 } })
      ev('message_stop', {})
      res.end()
    })
  }
}
