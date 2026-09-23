import 'server-only'
import type { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { customerLocaleFrom, type CustomerLocale } from '@/lib/i18n/config'
import { signCustomerToken, verifyCustomerToken } from './token'

/**
 * Customer API authentication (CLAUDE.md §1). A request carries either
 *   Authorization: Bearer <LIFF access token>  — verified with LINE, twice:
 *     1. /oauth2/v2.1/verify → the token is live AND its client_id is this branch's LINE Login channel
 *     2. /v2/profile         → the LINE user id
 *   X-Customer-Token: <signed token>          — issued by us after step 1, bound to the branch.
 * Only after that does a route use the service role, always scoped to this customer + branch.
 */

export type CustomerBranch = { id: string; code: string; name: string; liff_id: string | null; line_channel_id: string | null }
export type CustomerSession = { customer: { id: string; line_user_id: string; locale: CustomerLocale; display_name: string | null }; branch: CustomerBranch; token: string }
export type CustomerAuthError = 'unauthenticated' | 'branch_not_found' | 'wrong_channel' | 'line_unavailable'

const LINE_API = 'https://api.line.me'

export async function branchByCode(code: string): Promise<CustomerBranch | null> {
  if (!/^[a-z]{2,5}$/i.test(code)) return null
  const { data, error } = await getSupabaseAdmin()
    .from('branches')
    .select('id, code, name, liff_id, line_channel_id')
    .eq('code', code.toUpperCase())
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return data
}

async function verifyLiffToken(accessToken: string, channelId: string): Promise<{ userId: string; displayName: string | null; pictureUrl: string | null } | CustomerAuthError> {
  let verify: Response
  try {
    verify = await fetch(`${LINE_API}/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`, { cache: 'no-store' })
  } catch {
    return 'line_unavailable'
  }
  if (!verify.ok) return 'unauthenticated'
  const v = (await verify.json()) as { client_id?: string; expires_in?: number }
  if (!v.client_id || v.client_id !== channelId) return 'wrong_channel'
  if (!v.expires_in || v.expires_in <= 0) return 'unauthenticated'

  let profile: Response
  try {
    profile = await fetch(`${LINE_API}/v2/profile`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  } catch {
    return 'line_unavailable'
  }
  if (!profile.ok) return 'unauthenticated'
  const p = (await profile.json()) as { userId?: string; displayName?: string; pictureUrl?: string }
  if (!p.userId || !/^U[0-9a-f]{32}$/.test(p.userId)) return 'unauthenticated'
  return { userId: p.userId, displayName: p.displayName ?? null, pictureUrl: p.pictureUrl ?? null }
}

/**
 * Resolve the calling customer for a branch (by URL code). `locale` is the LIFF
 * language on first contact; afterwards the stored customers.locale wins.
 */
export async function requireCustomer(req: NextRequest, branchCode: string, locale?: string): Promise<CustomerSession | CustomerAuthError> {
  const branch = await branchByCode(branchCode)
  if (!branch) return 'branch_not_found'
  const admin = getSupabaseAdmin()

  const signed = verifyCustomerToken(req.headers.get('x-customer-token'))
  if (signed && signed.br === branch.id) {
    const { data, error } = await admin.from('customers').select('id, line_user_id, locale, display_name').eq('id', signed.sub).maybeSingle()
    if (error) return 'line_unavailable'
    if (data) return { customer: data, branch, token: req.headers.get('x-customer-token')! }
  }

  const auth = req.headers.get('authorization') ?? ''
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!accessToken || accessToken.length > 2048) return 'unauthenticated'
  if (!branch.line_channel_id) return 'wrong_channel'
  const line = await verifyLiffToken(accessToken, branch.line_channel_id)
  if (typeof line === 'string') return line

  const { data: existing, error: findError } = await admin
    .from('customers')
    .select('id, line_user_id, locale, display_name')
    .eq('line_user_id', line.userId)
    .maybeSingle()
  if (findError) return 'line_unavailable'
  let customer = existing
  if (!customer) {
    const { data: created, error } = await admin
      .from('customers')
      .insert({ line_user_id: line.userId, display_name: line.displayName, picture_url: line.pictureUrl, locale: customerLocaleFrom(locale) })
      .select('id, line_user_id, locale, display_name')
      .single()
    if (error || !created) return 'line_unavailable'
    customer = created
  } else if (line.displayName && line.displayName !== customer.display_name) {
    // a stale display name is cosmetic: the session still stands if this refresh fails
    const { error: refreshError } = await admin.from('customers').update({ display_name: line.displayName, picture_url: line.pictureUrl }).eq('id', customer.id)
    if (!refreshError) customer = { ...customer, display_name: line.displayName }
  }
  return { customer, branch, token: signCustomerToken(customer.id, branch.id) }
}

export function customerAuthStatus(e: CustomerAuthError): number {
  return e === 'branch_not_found' ? 404 : e === 'line_unavailable' ? 503 : 401
}
