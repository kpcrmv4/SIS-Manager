import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { TERMS_VERSION } from '@/components/liff/constants'
import { readJsonBody } from '../_lib/body'
import { rpcError } from '../_lib/respond'

export const runtime = 'nodejs'

type Body = { name?: string; phone?: string; item_name?: string; quantity?: number; table?: string; notes?: string; accepted?: boolean }

/**
 * "ฝากขวดเพิ่ม" from the LIFF app (P2-C2) → customer_request_deposit. The terms version is
 * always OUR constant, never whatever the client sends — a stale client cannot backdate the
 * version it agreed to. `accepted` is enforced here too, ahead of the RPC's own TERMS_REQUIRED
 * check, so the UI error matches the exact field the customer skipped.
 */
export async function POST(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const parsed = await readJsonBody<Body>(req)
  if (!parsed.ok) return NextResponse.json({ error: 'invalid' }, { status: parsed.status })
  const { name, phone, item_name, quantity, table, notes, accepted } = parsed.body

  const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : ''
  const cleanItem = typeof item_name === 'string' ? item_name.trim().slice(0, 120) : ''
  if (!cleanName) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (!cleanItem) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return NextResponse.json({ error: 'BAD_QUANTITY' }, { status: 400 })
  }
  if (accepted !== true) return NextResponse.json({ error: 'terms_required' }, { status: 400 })

  const { data, error } = await getSupabaseAdmin().rpc('customer_request_deposit', {
    p_branch: s.branch.id,
    p_customer_id: s.customer.id,
    p_customer_name: cleanName,
    p_item_name: cleanItem,
    p_quantity: quantity,
    p_terms_version: TERMS_VERSION,
    p_terms_locale: s.customer.locale,
    p_customer_phone: typeof phone === 'string' ? phone.trim().slice(0, 30) || undefined : undefined,
    p_table: typeof table === 'string' ? table.trim().slice(0, 20) || undefined : undefined,
    p_notes: typeof notes === 'string' ? notes.trim().slice(0, 300) || undefined : undefined,
  })
  if (error) return rpcError(error)
  return NextResponse.json({ ok: true, ...(data as object) }, { status: 201 })
}
