import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseForResponse } from '@/lib/supabase/route'

export const runtime = 'nodejs'

/** Ends this device's session only (scope 'local'); the client then location.replace('/login'). */
export async function POST(req: NextRequest) {
  const response = NextResponse.json({ ok: true })
  const supabase = getSupabaseForResponse(req, response)
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  // No session is not an error for logout: the goal state is reached either way.
  if (error && error.status !== 401 && error.status !== 403) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
  return response
}

const REASONS = new Set(['stale', 'inactive'])

/**
 * The staff layout lands here when the cookie still carries a valid JWT but
 * the session is gone (revoked elsewhere) or the profile was disabled. Clearing
 * the cookie before showing /login is what stops the proxy (which trusts the
 * JWT) and the layout (which asks Auth) from bouncing the browser forever.
 */
export async function GET(req: NextRequest) {
  const reason = req.nextUrl.searchParams.get('reason')
  const target = new URL('/login', req.nextUrl.origin)
  if (reason && REASONS.has(reason)) target.searchParams.set('reason', reason)
  const response = NextResponse.redirect(target, 303)
  const supabase = getSupabaseForResponse(req, response)
  await supabase.auth.signOut({ scope: 'local' })
  // signOut on an already-dead session may not emit cookie deletions; clear them ourselves.
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-')) response.cookies.set(c.name, '', { path: '/', maxAge: 0 })
  }
  return response
}
