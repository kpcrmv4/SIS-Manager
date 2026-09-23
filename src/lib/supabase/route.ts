import 'server-only'
import { createServerClient } from '@supabase/ssr'
import type { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertPublicEnv } from './env'

/**
 * A client whose cookie writes land on the given response object. Use in any
 * route handler that signs in or out — writing through next/headers cookies()
 * does not reliably reach a NextResponse.json() returned from a route.
 */
export function getSupabaseForResponse(req: NextRequest, res: NextResponse) {
  assertPublicEnv()
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(toSet) {
        toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
      },
    },
  })
}
