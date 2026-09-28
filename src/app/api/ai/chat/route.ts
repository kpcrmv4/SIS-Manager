import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse, type NextRequest } from 'next/server'
import { getActorState } from '@/lib/auth/actor'
import { aiClient, aiErrorCode, getAiConfig } from '@/lib/ai/config'
import { AI_TOOLS, runTool, type ToolCtx } from '@/lib/ai/tools'
import { buildProposal, isProposalTool, proposalToolsFor } from '@/lib/ai/proposals'
import { contextBlock, systemPrompt } from '@/lib/ai/prompt'
import { cleanPath, pageExtra } from '@/lib/ai/page'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { businessNight } from '@/lib/date'
import { TIME_ZONE } from '@/lib/constants'

export const runtime = 'nodejs'
export const maxDuration = 60

type Turn = { role: 'user' | 'assistant'; text: string }
type Body = { messages?: Turn[]; path?: string; pageTitle?: string }

const MAX_TURNS = 16
const MAX_TEXT = 4000
const MAX_QUESTION = 1000
const MAX_TOOL_ROUNDS = 6
const PER_HOUR = 60

/** Models that take the server-side refusal fallback (R-070): the Opus 5 / Fable 5 lines. */
const withFallback = (model: string) => /^claude-(opus-5|fable-5)/.test(model)

/**
 * R-070 — the staff assistant. The signed-in user's session does the reading (tools), the
 * owner's API key does the talking. Streams server-sent events: text deltas, a note while a
 * tool runs, then done — or one error.
 */
export async function POST(req: NextRequest) {
  const state = await getActorState()
  if (state.status !== 'ok') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const me = state.actor
  if (!me.branch) return NextResponse.json({ error: 'no_branch' }, { status: 409 })

  const config = await getAiConfig()
  if (!config.enabledRoles.includes(me.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const ai = await aiClient()
  if (!ai) return NextResponse.json({ error: 'ai_not_configured' }, { status: 409 })

  const body = (await req.json().catch(() => null)) as Body | null
  const turns = Array.isArray(body?.messages) ? body.messages : []
  const clean = turns
    .filter((t): t is Turn => (t?.role === 'user' || t?.role === 'assistant') && typeof t.text === 'string' && t.text.trim().length > 0)
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_TEXT) }))
  while (clean.length && clean[0].role !== 'user') clean.shift()
  const last = clean[clean.length - 1]
  if (!last || last.role !== 'user' || last.text.length > MAX_QUESTION) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const { count } = await admin.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', me.id).gte('created_at', hourAgo)
  if ((count ?? 0) >= PER_HOUR) return NextResponse.json({ error: 'ai_rate_limited' }, { status: 429 })

  const path = cleanPath(body?.path)
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, dateStyle: 'full', timeStyle: 'short' }).format(new Date())
  const context = contextBlock({
    path,
    pageTitle: typeof body?.pageTitle === 'string' ? body.pageTitle.slice(0, 80) : null,
    branchName: me.branch.name,
    displayName: me.displayName,
    now,
    night: businessNight(),
    extra: await pageExtra(me.branch.id, path),
  })

  const messages: Anthropic.Beta.BetaMessageParam[] = clean.map((t, i) =>
    i === clean.length - 1
      ? { role: 'user', content: [{ type: 'text', text: context }, { type: 'text', text: t.text }] }
      : { role: t.role, content: t.text },
  )
  const ctx: ToolCtx = { branchId: me.branch.id, role: me.role, locale: me.locale }
  const tools = [...AI_TOOLS, ...proposalToolsFor(me.role)]
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: systemPrompt(me.role, me.locale), cache_control: { type: 'ephemeral' } }]
  const enc = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`))
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tools: 0 }
      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const s = ai.client.beta.messages.stream({
            model: ai.model,
            max_tokens: 16000,
            system,
            tools: round < MAX_TOOL_ROUNDS ? tools : undefined,
            messages,
            ...(withFallback(ai.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          })
          s.on('text', (delta) => send({ type: 'text', text: delta }))
          const msg = await s.finalMessage()
          usage.input += msg.usage.input_tokens
          usage.output += msg.usage.output_tokens
          usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0
          usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0

          if (msg.stop_reason === 'refusal') {
            send({ type: 'error', error: 'ai_refused' })
            break
          }
          const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
          if (msg.stop_reason !== 'tool_use' || calls.length === 0) break

          messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] })
          send({ type: 'tool', names: calls.map((c) => c.name) })
          usage.tools += calls.length
          const results = await Promise.all(
            calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
              try {
                // R-071: an action is only prepared — a card the person confirms in the panel
                if (isProposalTool(c.name)) {
                  const built = await buildProposal(c.name, c.input, ctx)
                  if (!built.ok) return { type: 'tool_result', tool_use_id: c.id, content: `not prepared: ${built.reason}` }
                  send({ type: 'proposal', proposal: built.proposal })
                  return {
                    type: 'tool_result',
                    tool_use_id: c.id,
                    content: 'A confirmation card with these details is now shown under your message. Nothing has happened yet: say in one short sentence what the card will do and that they press ยืนยัน on the card (or ยกเลิก). Never say it is done.',
                  }
                }
                const r = await runTool(c.name, c.input, ctx)
                return { type: 'tool_result', tool_use_id: c.id, content: r.content, is_error: r.isError }
              } catch {
                return { type: 'tool_result', tool_use_id: c.id, content: 'the lookup failed', is_error: true }
              }
            }),
          )
          messages.push({ role: 'user', content: results })
          // a new paragraph between what was said before the lookup and the answer
          send({ type: 'text', text: '\n\n' })
        }
        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', error: aiErrorCode(err) })
      } finally {
        await admin.from('ai_usage').insert({
          user_id: me.id,
          branch_id: me.branch!.id,
          model: ai.model,
          input_tokens: usage.input,
          output_tokens: usage.output,
          cache_read_tokens: usage.cacheRead,
          cache_write_tokens: usage.cacheWrite,
          tool_calls: usage.tools,
        })
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
