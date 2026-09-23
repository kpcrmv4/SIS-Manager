'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env'

let client: ReturnType<typeof createBrowserClient<Database>> | undefined

/** Singleton browser client — client components only. */
export function getSupabaseBrowser() {
  if (!client) client = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  return client
}
