'use server'

import { revalidatePath } from 'next/cache'
import { callRpc, cleanText, isUuid } from '@/lib/action'
import { liffUrl } from '@/lib/line/render'
import type { ActionResult } from '@/lib/errors'

/**
 * R-058 · the staff side of "ให้ลูกค้าสแกนผูก LINE": make the one-time QR, kill it when the
 * sheet closes, and ask where it stands while the sheet is open. R-059 · who owns a typed phone,
 * and linking a deposit to that owner. The RPCs check role + branch.
 */

export type LinkQr = { url: string; expiresAt: string; known: boolean; knownId: string | null; knownName: string | null; also: number }
export type LinkQrStatus = { linked: boolean; live: boolean; name: string | null; viaQr: boolean; returning: boolean; count: number }
export type PhoneOwner = { customerId: string; name: string | null; lastName: string | null; open: number }

export async function issueLinkQr(depositId: string): Promise<ActionResult<LinkQr>> {
  if (!isUuid(depositId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ token: string; expires_at: string; liff_id: string; known: boolean; known_id: string | null; known_name: string | null; also: number }>((sb) =>
    sb.rpc('issue_link_qr', { p_deposit: depositId }),
  )
  if (!res.ok) return res
  const url = liffUrl(res.data.liff_id, `/link?t=${res.data.token}`)
  if (!url) return { ok: false, error: 'NO_LIFF' }
  const d = res.data
  return { ok: true, data: { url, expiresAt: d.expires_at, known: d.known, knownId: d.known_id, knownName: d.known_name, also: d.also } }
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

/** The one LINE customer this phone belongs to at the branch, or null (a new phone, or one two customers share). */
export async function lookupPhoneOwner(branchId: string, phone: string): Promise<ActionResult<PhoneOwner | null>> {
  const p = cleanText(phone, 30)
  if (!isUuid(branchId) || !p) return { ok: true, data: null }
  const res = await callRpc<{ customer_id: string; name: string | null; last_name: string | null; open: number } | null>((sb) =>
    sb.rpc('phone_customer', { p_branch: branchId, p_phone: p }),
  )
  if (!res.ok) return res
  const d = res.data
  return { ok: true, data: d ? { customerId: d.customer_id, name: d.name, lastName: d.last_name, open: d.open } : null }
}

/** Link an unlinked deposit to its phone's owner — refused unless that customer still owns the phone. */
export async function linkPhoneOwner(depositId: string, customerId: string): Promise<ActionResult> {
  if (!isUuid(depositId) || !isUuid(customerId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<undefined>((sb) => sb.rpc('link_phone_owner', { p_deposit: depositId, p_customer: customerId }))
  if (res.ok) {
    revalidatePath('/deposits')
    revalidatePath(`/deposits/${depositId}`)
  }
  return res
}
