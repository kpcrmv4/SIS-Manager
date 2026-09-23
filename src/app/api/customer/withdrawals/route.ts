import { NextResponse, after, type NextRequest } from 'next/server'
import { dispatchSoon } from '@/lib/line/dispatch'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { readJsonBody } from '../_lib/body'
import { rpcError } from '../_lib/respond'

export const runtime = 'nodejs'

type Body = { deposit_id?: string; bottle_ids?: string[]; type?: 'in_store' | 'take_home'; table?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "ขอเบิกเหล้า" from the LIFF app (P2-C2) → request_withdrawal, scoped to this customer + branch
 * server-side (never taken from the body — security rule #2). The RPC checks the deposit's
 * customer_id against p_customer_id, so a bottle_id/deposit_id that isn't the caller's own is
 * refused (NOT_YOURS), not silently accepted.
 */
export async function POST(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const parsed = await readJsonBody<Body>(req)
  if (!parsed.ok) return NextResponse.json({ error: 'invalid' }, { status: parsed.status })
  const { deposit_id, bottle_ids, type, table } = parsed.body
  if (!deposit_id || !UUID.test(deposit_id)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  if (!Array.isArray(bottle_ids) || bottle_ids.length === 0 || bottle_ids.length > 50 || !bottle_ids.every((b) => UUID.test(b))) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  if (type !== 'in_store' && type !== 'take_home') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const cleanTable = typeof table === 'string' ? table.trim().slice(0, 20) || undefined : undefined

  const { data, error } = await getSupabaseAdmin().rpc('request_withdrawal', {
    p_deposit: deposit_id,
    p_bottle_ids: bottle_ids,
    p_type: type,
    p_table: cleanTable,
    p_customer_id: s.customer.id,
    p_branch: s.branch.id,
  })
  if (error) return rpcError(error)
  after(() => dispatchSoon())
  return NextResponse.json({ ok: true, ...(data as object) }, { status: 201 })
}
