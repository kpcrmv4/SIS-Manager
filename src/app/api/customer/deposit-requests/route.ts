import { NextResponse, after, type NextRequest } from 'next/server'
import { dispatchSoon } from '@/lib/line/dispatch'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { rememberContact } from '@/lib/customer/contact'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { TERMS_VERSION } from '@/components/liff/constants'
import { readJsonBody } from '../_lib/body'
import { rpcError } from '../_lib/respond'

export const runtime = 'nodejs'

type BodyItem = { item_name?: string; quantity?: number }
type Body = BodyItem & { items?: BodyItem[]; name?: string; phone?: string; table?: string; notes?: string; accepted?: boolean }

/**
 * "ฝากเหล้าเพิ่ม" from the LIFF app (P2-C2) → customer_request_deposits: 1-10 items, each its own
 * deposit and code, in one transaction (R-068; a single item_name/quantity still works). The terms version is
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
  const { name, phone, table, notes, accepted } = parsed.body
  const raw: unknown[] = Array.isArray(parsed.body.items) ? parsed.body.items : [{ item_name: parsed.body.item_name, quantity: parsed.body.quantity }]

  const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : ''
  if (!cleanName) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (raw.length < 1 || raw.length > 10) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const items: { item_name: string; quantity: number }[] = []
  for (const it of raw) {
    const r = (it ?? {}) as BodyItem
    const cleanItem = typeof r.item_name === 'string' ? r.item_name.trim().slice(0, 120) : ''
    if (!cleanItem) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    if (typeof r.quantity !== 'number' || !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 50) {
      return NextResponse.json({ error: 'BAD_QUANTITY' }, { status: 400 })
    }
    items.push({ item_name: cleanItem, quantity: r.quantity })
  }
  if (accepted !== true) return NextResponse.json({ error: 'terms_required' }, { status: 400 })

  const { data, error } = await getSupabaseAdmin().rpc('customer_request_deposits', {
    p_branch: s.branch.id,
    p_customer_id: s.customer.id,
    p_customer_name: cleanName,
    p_items: items,
    p_terms_version: TERMS_VERSION,
    p_terms_locale: s.customer.locale,
    p_customer_phone: typeof phone === 'string' ? phone.trim().slice(0, 30) || undefined : undefined,
    p_table: typeof table === 'string' ? table.trim().slice(0, 20) || undefined : undefined,
    p_notes: typeof notes === 'string' ? notes.trim().slice(0, 300) || undefined : undefined,
  })
  if (error) return rpcError(error)
  after(() => dispatchSoon())
  // R-065: what they just gave is what the next form fills in
  after(() => rememberContact(s.customer.id, cleanName, typeof phone === 'string' ? phone : undefined))
  const made = (data as { deposits: { id: string; code: string }[] }).deposits
  // the single-item shape stays as it was ({ id, code }) for any client that reads it
  return NextResponse.json({ ok: true, id: made[0]?.id, code: made[0]?.code, deposits: made }, { status: 201 })
}
