import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertPublicEnv } from './env'

/**
 * Server Components, server actions and read-only route handlers. Not for
 * establishing a session in a route handler — those bind cookies to the
 * response (see app/api/auth/login/route.ts).
 */
export async function getSupabaseServer() {
  assertPublicEnv()
  const store = await cookies()
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          // Server Component render: the proxy refreshes the session instead.
        }
      },
    },
  })
}
