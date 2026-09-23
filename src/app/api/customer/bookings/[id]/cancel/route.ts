import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { readJsonBody } from '../../../_lib/body'
import { rpcError } from '../../../_lib/respond'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = { reason?: string }

/** "ยกเลิกการจอง" (P2-C3) → cancel_booking; the RPC itself enforces the cancel window. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const parsed = await readJsonBody<Body>(req)
  if (!parsed.ok) return NextResponse.json({ error: 'invalid' }, { status: parsed.status })

  const { data, error } = await getSupabaseAdmin().rpc('cancel_booking', {
    p_booking: id,
    p_reason: typeof parsed.body.reason === 'string' ? parsed.body.reason.trim().slice(0, 200) || undefined : undefined,
    p_customer_id: s.customer.id,
    p_branch: s.branch.id,
  })
  if (error) return rpcError(error)
  return NextResponse.json({ ok: true, ...(data as object) })
}
