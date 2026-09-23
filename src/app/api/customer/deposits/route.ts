import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { businessNight, weekdayIndex } from '@/lib/date'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * This customer's deposits at this branch, with bottles (P2-C2). Never returns another
 * customer's rows — every filter carries both `customer_id` and `branch_id` (security rule #3).
 */
export async function GET(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const admin = getSupabaseAdmin()
  const [{ data: deposits, error }, { data: branch }] = await Promise.all([
    admin
      .from('deposits')
      .select('id, code, item_name, quantity, remaining_qty, remaining_percent, status, is_vip, expires_at, collect_deadline_at, table_label, deposit_bottles(id, bottle_no, remaining_percent, status)')
      .eq('customer_id', s.customer.id)
      .eq('branch_id', s.branch.id)
      .order('created_at', { ascending: false })
      .range(0, 199),
    admin.from('branches').select('deposit_days, withdrawal_blocked_days').eq('id', s.branch.id).single(),
  ])
  if (error) return NextResponse.json({ error: 'unknown' }, { status: 503 })

  const blockedDays = branch?.withdrawal_blocked_days ?? []
  const todayName = DOW[weekdayIndex(businessNight())]
  const blockedToday = blockedDays.includes(todayName)

  return NextResponse.json({
    deposits: deposits ?? [],
    blockedToday,
    branch: { depositDays: branch?.deposit_days ?? 30, blockedDays },
  })
}
