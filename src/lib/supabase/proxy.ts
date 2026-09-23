import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env'

const PUBLIC_PATHS = ['/login', '/liff', '/manifest.webmanifest', '/sw.js', '/offline']

function isPublic(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
}

/**
 * Refreshes the Supabase session cookie and gates staff pages.
 *   - /api/* is never redirected: API routes answer JSON 401 themselves
 *     (a 307 to the HTML login page swallows server-side sign-in).
 *   - /liff/* is the customer app: LINE, not Supabase Auth.
 * getClaims() verifies the JWT locally (asymmetric keys) — no Auth round-trip
 * per request; pages that must know the session is not revoked call getUser().
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  const path = request.nextUrl.pathname
  if (path.startsWith('/api/')) return response

  if (!signedIn && !isPublic(path)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    if (path !== '/') url.searchParams.set('next', path + request.nextUrl.search)
    return NextResponse.redirect(url)
  }
  if (signedIn && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }
  return response
}
