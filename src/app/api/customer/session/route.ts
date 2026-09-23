import { NextResponse, type NextRequest } from 'next/server'
import { customerAuthStatus, requireCustomer } from '@/lib/customer/auth'
import { readJsonBody } from '../_lib/body'

export const runtime = 'nodejs'

type Body = { locale?: string }

/**
 * Establishes (or renews) a customer session (P2-C1). The caller proves identity either with
 * `Authorization: Bearer <LIFF access token>` (fresh LINE login) or `X-Customer-Token` (an
 * already-issued token, including the E2E test double) — `requireCustomer` tries the signed
 * token first, then falls back to LINE. `locale` is only used the first time a customer row
 * is created (from `liff.getLanguage()`); afterwards `customers.locale` wins.
 */
export async function POST(req: NextRequest) {
  const branchCode = req.nextUrl.searchParams.get('branch') ?? ''
  const parsed = await readJsonBody<Body>(req)
  const locale = parsed.ok && typeof parsed.body.locale === 'string' ? parsed.body.locale : undefined

  const s = await requireCustomer(req, branchCode, locale)
  if (typeof s === 'string') return NextResponse.json({ error: s }, { status: customerAuthStatus(s) })

  return NextResponse.json({
    token: s.token,
    customer: { id: s.customer.id, display_name: s.customer.display_name, locale: s.customer.locale },
    branch: { code: s.branch.code, name: s.branch.name },
  })
}
