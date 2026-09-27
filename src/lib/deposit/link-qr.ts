'use server'

import { callRpc, isUuid } from '@/lib/action'
import { liffUrl } from '@/lib/line/render'
import type { ActionResult } from '@/lib/errors'

/**
 * R-058 · the staff side of "ให้ลูกค้าสแกนผูก LINE": make the one-time QR, kill it when the
 * sheet closes, and ask where it stands while the sheet is open. The RPCs check role + branch.
 */

export type LinkQr = { url: string; expiresAt: string; known: boolean; knownName: string | null; also: number }
export type LinkQrStatus = { linked: boolean; live: boolean; name: string | null; viaQr: boolean; returning: boolean; count: number }

export async function issueLinkQr(depositId: string): Promise<ActionResult<LinkQr>> {
  if (!isUuid(depositId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ token: string; expires_at: string; liff_id: string; known: boolean; known_name: string | null; also: number }>((sb) =>
    sb.rpc('issue_link_qr', { p_deposit: depositId }),
  )
  if (!res.ok) return res
  const url = liffUrl(res.data.liff_id, `/link?t=${res.data.token}`)
  if (!url) return { ok: false, error: 'NO_LIFF' }
  return { ok: true, data: { url, expiresAt: res.data.expires_at, known: res.data.known, knownName: res.data.known_name, also: res.data.also } }
}

export async function revokeLinkQr(depositId: string): Promise<ActionResult> {
  if (!isUuid(depositId)) return { ok: false, error: 'invalid' }
  return callRpc<undefined>((sb) => sb.rpc('revoke_link_qr', { p_deposit: depositId }))
}

export async function linkQrStatus(depositId: string): Promise<ActionResult<LinkQrStatus>> {
  if (!isUuid(depositId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ linked: boolean; live: boolean; name?: string | null; via_qr?: boolean; returning?: boolean; count?: number }>((sb) =>
    sb.rpc('link_qr_status', { p_deposit: depositId }),
  )
  if (!res.ok) return res
  const d = res.data
  return { ok: true, data: { linked: d.linked, live: d.live, name: d.name ?? null, viaQr: d.via_qr ?? false, returning: d.returning ?? false, count: d.count ?? 1 } }
}
