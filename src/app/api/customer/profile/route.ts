import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { CUSTOMER_LOCALE_COOKIE, isCustomerLocale } from '@/lib/i18n/config'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { readJsonBody } from '../_lib/body'

export const runtime = 'nodejs'

type Body = { locale?: string }

/** The LIFF language picker (P2-C1): saves customers.locale and the cookie the SSR shell reads next load. */
export async function PATCH(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const s = await requireCustomer(req, branchCode)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  const parsed = await readJsonBody<Body>(req)
  if (!parsed.ok) return NextResponse.json({ error: 'invalid' }, { status: parsed.status })
  if (!isCustomerLocale(parsed.body.locale)) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  const { error } = await getSupabaseAdmin().from('customers').update({ locale: parsed.body.locale }).eq('id', s.customer.id)
  if (error) return NextResponse.json({ error: 'unknown' }, { status: 503 })

  const res = NextResponse.json({ ok: true, locale: parsed.body.locale })
  res.cookies.set(CUSTOMER_LOCALE_COOKIE, parsed.body.locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  return res
}
