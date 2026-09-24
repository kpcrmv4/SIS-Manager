'use server'

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getActorState } from '@/lib/auth/actor'
import { callRpc, isUuid } from '@/lib/action'
import { auditAs } from '@/lib/audit/write'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getSupabaseServer } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/errors'
import { dispatchSoon } from './dispatch'
import { lineAddFriendUrl, pngDataUrl } from '@/lib/print/qr'

/**
 * /settings/line (P3-A2-06..09), owner only. The branch's public LINE ids go through the
 * session client (RLS: owner writes branches). The channel secret and access token live in
 * branch_line_secrets, which no signed-in role can read or write (RULINGS R-002) — they are
 * written here with the service role, ONLY after the caller is proven to be an owner, and are
 * never returned to the browser.
 */

export type LineField = 'liffId' | 'channelId' | 'botUserId' | 'accessToken' | 'channelSecret'
export type LineSettingsInput = { liffId: string; channelId: string; botUserId: string; accessToken?: string; channelSecret?: string }
export type LineSettingsResult = { ok: true } | { ok: false; error: 'FORBIDDEN' | 'unknown' } | { ok: false; error: 'invalid'; field: LineField }

const FORMATS: Record<LineField, RegExp> = {
  liffId: /^\d{4,20}-[A-Za-z0-9]{4,32}$/,
  channelId: /^\d{4,20}$/,
  botUserId: /^@[A-Za-z0-9._-]{2,40}$/,
  accessToken: /^[A-Za-z0-9+/=._-]{20,600}$/,
  channelSecret: /^[A-Za-z0-9]{16,128}$/,
}

/** the owner acting on this branch, or null */
async function ownerOf(branchId: string) {
  if (!isUuid(branchId)) return null
  const state = await getActorState()
  return state.status === 'ok' && state.actor.role === 'owner' && state.actor.branches.some((b) => b.id === branchId) ? state.actor : null
}

export async function saveLineSettings(branchId: string, input: LineSettingsInput): Promise<LineSettingsResult> {
  const owner = await ownerOf(branchId)
  if (!owner) return { ok: false, error: 'FORBIDDEN' }

  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const liffId = clean(input.liffId)
  const channelId = clean(input.channelId)
  let botUserId = clean(input.botUserId)
  if (botUserId && !botUserId.startsWith('@')) botUserId = `@${botUserId}`
  const accessToken = clean(input.accessToken)
  const channelSecret = clean(input.channelSecret)
  const values: Record<LineField, string> = { liffId, channelId, botUserId, accessToken, channelSecret }
  for (const field of Object.keys(FORMATS) as LineField[]) {
    if (values[field] && !FORMATS[field].test(values[field])) return { ok: false, error: 'invalid', field }
  }

  const sb = await getSupabaseServer()
  const { data: before, error: beforeError } = await sb.from('branches').select('line_bot_user_id, receipt_settings').eq('id', branchId).maybeSingle()
  if (beforeError) return { ok: false, error: 'unknown' }

  // the receipt's add-friend QR is built from the OA id — keep it in step when the id changes
  const receipt = (before?.receipt_settings ?? {}) as Record<string, unknown>
  const oaChanged = (before?.line_bot_user_id ?? null) !== (botUserId || null)
  const receiptPatch =
    oaChanged && receipt.show_qr
      ? botUserId
        ? { receipt_settings: { ...receipt, qr_code_image_url: await pngDataUrl(lineAddFriendUrl(botUserId)) } }
        : { receipt_settings: { ...receipt, show_qr: false, qr_code_image_url: null } }
      : {}

  const { data, error } = await sb
    .from('branches')
    .update({ liff_id: liffId || null, line_channel_id: channelId || null, line_bot_user_id: botUserId || null, ...receiptPatch })
    .eq('id', branchId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: 'unknown' }
  if (!data) return { ok: false, error: 'FORBIDDEN' }

  if (accessToken || channelSecret) {
    // partial upsert: PostgREST only sets the columns sent, so a blank field keeps its value
    const row = {
      branch_id: branchId,
      ...(accessToken ? { channel_access_token: accessToken } : {}),
      ...(channelSecret ? { channel_secret: channelSecret } : {}),
    }
    const { error: secretError } = await getSupabaseAdmin().from('branch_line_secrets').upsert(row, { onConflict: 'branch_id' })
    if (secretError) return { ok: false, error: 'unknown' }
    // which keys changed — never their values (R-038)
    await auditAs(owner, {
      category: 'settings',
      action: 'line.secrets_updated',
      target: owner.branches.find((b) => b.id === branchId)?.name ?? null,
      targetId: branchId,
      branchId,
      details: { fields: [...(accessToken ? ['channel_access_token'] : []), ...(channelSecret ? ['channel_secret'] : [])] },
    })
  }
  revalidatePath('/settings/line')
  return { ok: true }
}

export async function newGroupBindCode(branchId: string): Promise<ActionResult<{ code: string; expires_at: string }>> {
  if (!(await ownerOf(branchId))) return { ok: false, error: 'FORBIDDEN' }
  return callRpc<{ code: string; expires_at: string }>((sb) => sb.rpc('new_group_bind_code', { p_branch: branchId }))
}

export async function sendLineTest(branchId: string): Promise<ActionResult<{ queued: boolean }>> {
  if (!(await ownerOf(branchId))) return { ok: false, error: 'FORBIDDEN' }
  const res = await callRpc<{ queued: boolean }>((sb) => sb.rpc('send_line_test', { p_branch: branchId }))
  if (res.ok) after(() => dispatchSoon())
  return res
}
