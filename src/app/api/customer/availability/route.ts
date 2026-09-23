import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { rpcError } from '../_lib/respond'

export const runtime = 'nodejs'

const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * Booking dates/slots for the LIFF date strip + slot grid (P2-C3): booking_availability, plus
 * the customer-bookable zones and how many in-store deposits this customer already has here
 * (the "คุณมีขวดฝากที่สาขานี้ N รายการ" hint) — both cheap to fetch alongside.
 */
export async function GET(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const from = req.nextUrl.searchParams.get('from') ?? ''
  const to = req.nextUrl.searchParams.get('to') ?? ''
  if (!YMD.test(from) || !YMD.test(to)) return NextResponse.json({ error: 'BAD_RANGE' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const [avail, zones, deposits] = await Promise.all([
    admin.rpc('booking_availability', { p_branch: s.branch.id, p_from: from, p_to: to }),
    admin.from('table_zones').select('id, name').eq('branch_id', s.branch.id).eq('customer_bookable', true).eq('active', true).order('sort'),
    admin.from('deposits').select('id', { count: 'exact', head: true }).eq('customer_id', s.customer.id).eq('branch_id', s.branch.id).eq('status', 'in_store'),
  ])
  if (avail.error) return rpcError(avail.error)

  return NextResponse.json({
    ...(avail.data as object),
    zones: zones.data ?? [],
    inStoreDeposits: deposits.count ?? 0,
  })
}
