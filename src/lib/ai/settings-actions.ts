'use server'

import Anthropic from '@anthropic-ai/sdk'
import { revalidatePath } from 'next/cache'
import { getActorState, type Role } from '@/lib/auth/actor'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getSupabaseServer } from '@/lib/supabase/server'
import { MODEL_RE, aiErrorCode, getAiConfig, type AiConfig } from './config'

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string }
const ROLES: Role[] = ['staff', 'bar', 'owner']

async function ownerId(): Promise<string | null> {
  const s = await getActorState()
  return s.status === 'ok' && s.actor.role === 'owner' ? s.actor.id : null
}

function touched() {
  revalidatePath('/settings/ai')
  revalidatePath('/', 'layout')
}

/** R-070: which roles may open the assistant, and the model name — written through RLS (owner only). */
export async function saveAiSettings(input: { enabledRoles: Role[]; model: string }): Promise<Result<AiConfig>> {
  const me = await ownerId()
  if (!me) return { ok: false, error: 'forbidden' }
  const roles = ROLES.filter((r) => input.enabledRoles.includes(r))
  const model = input.model.trim()
  if (!MODEL_RE.test(model)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('ai_settings').update({ enabled_roles: roles, model, updated_at: new Date().toISOString(), updated_by: me }).eq('id', true).select('id')
  if (error) return { ok: false, error: 'invalid' }
  if (!data?.length) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: await getAiConfig() }
}

/** The API key goes to ai_secrets with the service role — no one reads it back, the page shows a hint. */
export async function saveAiKey(key: string): Promise<Result<AiConfig>> {
  const me = await ownerId()
  if (!me) return { ok: false, error: 'forbidden' }
  const clean = key.trim()
  if (!/^sk-ant-[A-Za-z0-9_-]{16,290}$/.test(clean)) return { ok: false, error: 'ai_key_invalid' }
  const { error } = await getSupabaseAdmin().from('ai_secrets').upsert({ id: true, api_key: clean, updated_at: new Date().toISOString(), updated_by: me })
  if (error) return { ok: false, error: 'invalid' }
  touched()
  return { ok: true, data: await getAiConfig() }
}

export async function removeAiKey(): Promise<Result<AiConfig>> {
  const me = await ownerId()
  if (!me) return { ok: false, error: 'forbidden' }
  const { error } = await getSupabaseAdmin().from('ai_secrets').delete().eq('id', true)
  if (error) return { ok: false, error: 'invalid' }
  touched()
  return { ok: true, data: await getAiConfig() }
}

/** Checks the saved key against the saved model name without spending tokens (Models API). */
export async function testAi(): Promise<Result<{ model: string; name: string }>> {
  if (!(await ownerId())) return { ok: false, error: 'forbidden' }
  const admin = getSupabaseAdmin()
  const [{ data: s }, { data: k }] = await Promise.all([
    admin.from('ai_settings').select('model').eq('id', true).maybeSingle(),
    admin.from('ai_secrets').select('api_key').eq('id', true).maybeSingle(),
  ])
  if (!k?.api_key) return { ok: false, error: 'ai_not_configured' }
  const model = s?.model ?? ''
  try {
    const m = await new Anthropic({ apiKey: k.api_key, maxRetries: 0, timeout: 15_000 }).models.retrieve(model)
    return { ok: true, data: { model: m.id, name: m.display_name } }
  } catch (err) {
    return { ok: false, error: aiErrorCode(err) }
  }
}

export type AiUsageMonth = { answers: number; people: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number }

export async function aiUsageMonth(): Promise<Result<AiUsageMonth>> {
  if (!(await ownerId())) return { ok: false, error: 'forbidden' }
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('ai_usage_month')
  if (error) return { ok: false, error: 'invalid' }
  return { ok: true, data: data as unknown as AiUsageMonth }
}
