import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { rpcError } from '../_lib/respond'

export const runtime = 'nodejs'

const YMD = /^\d{4}-\d{2}-\d{2}$/

type Plan = {
  table_choice: string
  zones: { id: string; name: string; tables: { id: string; label: string; shape: string; seats_min: number; seats_max: number; state: string }[] }[]
}

/**
 * The floor plan of one night for "เลือกโต๊ะ" (R-036): every active zone and table as free /
 * taken / blocked. Only when the branch lets customers pick their table — otherwise 403, the
 * shop seats them. Never who holds a table.
 */
export async function GET(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const night = req.nextUrl.searchParams.get('night') ?? ''
  if (!YMD.test(night)) return NextResponse.json({ error: 'BAD_RANGE' }, { status: 400 })

  const { data, error } = await getSupabaseAdmin().rpc('table_availability', { p_branch: s.branch.id, p_night: night })
  if (error) return rpcError(error)
  const plan = data as unknown as Plan
  if (plan.table_choice !== 'customer') return NextResponse.json({ error: 'table_choice_off' }, { status: 403 })
  return NextResponse.json({ night, zones: plan.zones })
}
