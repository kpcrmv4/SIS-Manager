import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { dbErrorCode, type ActionResult } from '@/lib/errors'

type RpcClient = Awaited<ReturnType<typeof getSupabaseServer>>

/**
 * Run one RPC as the signed-in user and fold its outcome into an ActionResult.
 * Who (the session) is resolved before the RPC checks what; the RPC itself checks
 * role + branch, so nothing here is a security boundary.
 */
export async function callRpc<T>(fn: (sb: RpcClient) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<ActionResult<T>> {
  const sb = await getSupabaseServer()
  const { data: claims } = await sb.auth.getClaims()
  if (!claims?.claims?.sub) return { ok: false, error: 'unauthenticated' }
  const { data, error } = await fn(sb)
  if (error) return { ok: false, error: dbErrorCode(error) }
  return { ok: true, data: data as T } as ActionResult<T>
}

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export const cleanText = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}
