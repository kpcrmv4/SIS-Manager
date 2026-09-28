import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import type { Role } from '@/lib/auth/actor'

/** R-070: what the owner set on /settings/ai. The key never leaves the server. */
export type AiConfig = { enabledRoles: Role[]; model: string; hasKey: boolean; keyHint: string | null }

export const DEFAULT_MODEL = 'claude-opus-5'
export const MODEL_RE = /^[a-z0-9][a-z0-9.:@_-]{2,79}$/

/**
 * The one place a client is made. AI_API_BASE points the E2E dev server at a local mock of the
 * Messages API (tests/e2e/fixtures/ai-mock.ts) — unset everywhere else (L-009, as LINE_API_BASE).
 */
export function anthropicWith(apiKey: string, opts: { maxRetries?: number; timeout?: number } = {}): Anthropic {
  return new Anthropic({ apiKey, baseURL: process.env.AI_API_BASE || undefined, maxRetries: opts.maxRetries ?? 1, timeout: opts.timeout })
}

function hint(key: string): string {
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}

export async function getAiConfig(): Promise<AiConfig> {
  const admin = getSupabaseAdmin()
  const [{ data: s }, { data: k }] = await Promise.all([
    admin.from('ai_settings').select('enabled_roles, model').eq('id', true).maybeSingle(),
    admin.from('ai_secrets').select('api_key').eq('id', true).maybeSingle(),
  ])
  return {
    enabledRoles: (s?.enabled_roles ?? ['staff', 'bar', 'owner']) as Role[],
    model: s?.model ?? DEFAULT_MODEL,
    hasKey: Boolean(k?.api_key),
    keyHint: k?.api_key ? hint(k.api_key) : null,
  }
}

/** The client and model for one request — null when the owner has not set a key. */
export async function aiClient(): Promise<{ client: Anthropic; model: string } | null> {
  const admin = getSupabaseAdmin()
  const [{ data: s }, { data: k }] = await Promise.all([
    admin.from('ai_settings').select('model').eq('id', true).maybeSingle(),
    admin.from('ai_secrets').select('api_key').eq('id', true).maybeSingle(),
  ])
  if (!k?.api_key) return null
  return { client: anthropicWith(k.api_key), model: s?.model ?? DEFAULT_MODEL }
}

/**
 * An SDK error as one of our codes — by HTTP status, since instanceof fails when the SDK is
 * bundled into more than one server chunk.
 */
export function aiErrorCode(err: unknown): string {
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 0
  if (status === 401 || status === 403) return 'ai_key_rejected'
  if (status === 404) return 'ai_model_unknown'
  if (status === 429 || status === 529) return 'ai_busy'
  return 'ai_unreachable'
}

/** Can this role open the assistant right now (on for the role, and a key set)? */
export async function aiAvailableFor(role: Role): Promise<boolean> {
  const c = await getAiConfig()
  return c.hasKey && c.enabledRoles.includes(role)
}
