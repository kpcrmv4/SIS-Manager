import { NextResponse, type NextRequest } from 'next/server'
import { BRANCH_COOKIE, getActorState } from '@/lib/auth/actor'

export const runtime = 'nodejs'

const YEAR = 60 * 60 * 24 * 365
// branch-scoped pages only; decided on the parsed pathname, never on the raw string (open-redirect)
const ALLOWED_PATH = /^\/(deposits|bookings|settings)(\/[a-z0-9-]+)*$/

/**
 * GET /api/branch/go?b=<branch>&to=<path> — the overview's links into another branch's list:
 * switch the working branch (the same cookie setBranch writes, only for a branch the actor can
 * see) and land on the page. The cookie is a view preference, never an authorisation — every
 * page and RPC still checks the branch itself (R-030).
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const state = await getActorState()
  if (state.status !== 'ok') return NextResponse.redirect(new URL('/login', origin), 303)

  const branchId = req.nextUrl.searchParams.get('b') ?? ''
  const raw = req.nextUrl.searchParams.get('to') ?? ''
  let target: URL
  try {
    target = new URL(raw, origin)
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (!raw.startsWith('/') || target.origin !== origin || !ALLOWED_PATH.test(target.pathname)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (!state.actor.branches.some((b) => b.id === branchId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const res = NextResponse.redirect(target, 303)
  res.cookies.set(BRANCH_COOKIE, branchId, { path: '/', maxAge: YEAR, sameSite: 'lax', httpOnly: true })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
