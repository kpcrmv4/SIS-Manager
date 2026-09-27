import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { lineAddFriendUrl } from '@/lib/print/qr'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { readJsonBody } from '../_lib/body'
import { rpcError } from '../_lib/respond'

export const runtime = 'nodejs'

type Result =
  | { ok: true; already: boolean; returning: boolean; deposit_id: string; code: string; linked: number; bot_user_id: string | null }
  | { ok: false; error: 'EXPIRED' | 'NOT_YOURS' | 'BAD_STATE' | 'THROTTLED' }

const FAIL_STATUS = { EXPIRED: 410, NOT_YOURS: 403, BAD_STATE: 400, THROTTLED: 429 } as const

/**
 * R-058 · the customer scanned the staff's one-time QR (`/liff/<branch>/link?t=<token>`). The LIFF
 * login already proved the LINE account (requireCustomer); customer_link_by_qr uses the token once,
 * links the deposit and every other open deposit of that phone here, and says whether this LINE
 * account was already a customer.
 */
export async function POST(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const parsed = await readJsonBody<{ token?: unknown }>(req)
  if (!parsed.ok) return NextResponse.json({ error: 'invalid' }, { status: parsed.status })
  const token = typeof parsed.body.token === 'string' ? parsed.body.token.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{32}$/.test(token)) return NextResponse.json({ error: 'EXPIRED' }, { status: FAIL_STATUS.EXPIRED })

  const { data, error } = await getSupabaseAdmin().rpc('customer_link_by_qr', { p_branch: s.branch.id, p_customer: s.customer.id, p_token: token })
  if (error) return rpcError(error)
  const r = data as Result
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: FAIL_STATUS[r.error] ?? 400 })
  return NextResponse.json({
    already: r.already,
    returning: r.returning,
    code: r.code,
    linked: r.linked,
    name: s.customer.display_name,
    addFriendUrl: r.bot_user_id ? lineAddFriendUrl(r.bot_user_id) : null,
  })
}
