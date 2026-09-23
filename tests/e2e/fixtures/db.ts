import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/types/database'
import { AUTH_DIR, required } from './env'
import type { FixtureRole } from './users'

export type Db = SupabaseClient<Database>

let admin: Db | undefined

/** Service role — bypasses RLS. Every assertion through it filters by a fixture branch id. */
export function adminDb(): Db {
  if (!admin) {
    admin = createClient<Database>(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return admin
}

const roleClients = new Map<FixtureRole, Db>()

/**
 * A PostgREST client acting AS a fixture user, using the access token global
 * setup captured — no extra sign-in per test (Auth rate limit).
 */
export function dbAs(role: FixtureRole): Db {
  const hit = roleClients.get(role)
  if (hit) return hit
  const tokens = JSON.parse(readFileSync(join(AUTH_DIR, 'tokens.json'), 'utf8')) as Record<string, string>
  const token = tokens[role]
  if (!token) throw new Error(`E2E: no access token for ${role} — did global setup run?`)
  const client = createClient<Database>(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  roleClients.set(role, client)
  return client
}

/** An anonymous client (publishable key, no session). */
export function anonDb(): Db {
  return createClient<Database>(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Read-only SQL through the Management API (for catalogs PostgREST does not expose, e.g. cron.job). */
export async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const ref = required('SUPABASE_PROJECT_REF')
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${required('SUPABASE_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`sql → ${res.status}`)
  return (await res.json()) as T[]
}

/**
 * The login throttle counts failed logins per IP (20 / 15 min). Every E2E request comes from
 * the same local address, and several specs fail logins on purpose, so back-to-back runs
 * trip it for unrelated tests. Clears FAILED attempts from local / unknown addresses only.
 */
export async function clearLocalLoginThrottle(): Promise<void> {
  await sql("delete from private.login_attempts where not ok and ip in ('unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost')")
}

export function fixtureIds(): { branchA: string; branchB: string; users: Record<string, string> } {
  return JSON.parse(readFileSync(join(AUTH_DIR, 'fixture.json'), 'utf8'))
}

export function credsFor(role: FixtureRole): { username: string; email: string; password: string } {
  const creds = JSON.parse(readFileSync(join(AUTH_DIR, 'creds.json'), 'utf8')) as Record<string, { username: string; email: string; password: string }>
  return creds[role]
}
