import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { SUPABASE_URL, assertPublicEnv } from './env'

/**
 * Service-role client: bypasses RLS. SERVER ONLY — customer API routes (after
 * verifying LINE), owner user provisioning, cron and the print server.
 */
export function getSupabaseAdmin() {
  assertPublicEnv()
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not configured')
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
