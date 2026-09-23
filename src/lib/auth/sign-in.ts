import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { STAFF_LOCALE_COOKIE } from '@/lib/i18n/config'
import { getSupabaseForResponse } from '@/lib/supabase/route'

export type SignInResult =
  | { ok: true; response: NextResponse }
  | { ok: false; status: number; error: 'invalid' | 'inactive' | 'rate_limited' | 'unavailable' }

const YEAR = 60 * 60 * 24 * 365

/**
 * Signs in with e-mail + password and returns a response carrying the session
 * cookies. A profile that is missing or inactive is signed straight back out,
 * so /login never holds a half-valid session (no proxy ↔ login loop).
 */
export async function signInWithPassword(req: NextRequest, email: string, password: string): Promise<SignInResult> {
  const response = NextResponse.json({ ok: true })
  const supabase = getSupabaseForResponse(req, response)

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    if (error?.status === 429) return { ok: false, status: 429, error: 'rate_limited' }
    if (error && error.status && error.status >= 500) return { ok: false, status: 503, error: 'unavailable' }
    return { ok: false, status: 401, error: 'invalid' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('active, locale')
    .eq('id', data.user.id)
    .maybeSingle()

  if (profileError || !profile || !profile.active) {
    // The cookies were written onto `response`, which is discarded — the browser
    // never receives this session. signOut also revokes its refresh token.
    await supabase.auth.signOut({ scope: 'local' })
    return { ok: false, status: 403, error: profileError ? 'unavailable' : 'inactive' }
  }

  response.cookies.set(STAFF_LOCALE_COOKIE, profile.locale === 'en' ? 'en' : 'th', {
    path: '/',
    maxAge: YEAR,
    sameSite: 'lax',
  })
  return { ok: true, response }
}
