import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { request, type FullConfig } from '@playwright/test'
import { adminDb } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { SIGNED_IN_ROLES, ensureFixture } from './fixtures/users'

/** Session cookie value → access token (handles @supabase/ssr "base64-" + chunked cookies). */
function accessTokenFrom(cookies: { name: string; value: string }[]): string | null {
  const parts = cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  if (!parts.length) return null
  let raw = parts.map((c) => c.value).join('')
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8')
  try {
    return (JSON.parse(raw) as { access_token?: string }).access_token ?? null
  } catch {
    return null
  }
}

export default async function globalSetup(_config: FullConfig) {
  mkdirSync(AUTH_DIR, { recursive: true })
  const fixture = await ensureFixture(adminDb())
  writeFileSync(join(AUTH_DIR, 'creds.json'), JSON.stringify(fixture.creds, null, 2))
  writeFileSync(join(AUTH_DIR, 'fixture.json'), JSON.stringify({ branchA: fixture.branchA, branchB: fixture.branchB, users: fixture.users }, null, 2))

  // Warm the dev server: first compile of a route can exceed a test's budget.
  const warm = await request.newContext({ baseURL: BASE_URL })
  for (const path of ['/login', '/api/auth/logout']) await warm.get(path, { maxRedirects: 0 }).catch(() => undefined)
  // reuseExistingServer will happily reuse ANY app on this port — prove it is ours.
  const probe = await warm.get('/login')
  const html = await probe.text()
  await warm.dispose()
  if (!html.includes('SIS Manager')) {
    throw new Error(`global-setup: ${BASE_URL} is not SIS Manager (another app owns the port) — set E2E_PORT`)
  }

  // One sign-in per role per run, through our own login route (so the cookie
  // shape is exactly what a browser gets), saved as storageState.
  const tokens: Record<string, string> = {}
  for (const role of SIGNED_IN_ROLES) {
    const ctx = await request.newContext({ baseURL: BASE_URL })
    const c = fixture.creds[role]
    const res = await ctx.post('/api/auth/login', { data: { identifier: c.username, password: c.password } })
    if (!res.ok()) throw new Error(`global-setup: login ${role} → ${res.status()} ${await res.text()}`)
    const state = await ctx.storageState({ path: join(AUTH_DIR, `${role}.json`) })
    const token = accessTokenFrom(state.cookies)
    if (!token) throw new Error(`global-setup: no sb- session cookie for ${role}`)
    tokens[role] = token
    await ctx.dispose()
  }
  writeFileSync(join(AUTH_DIR, 'tokens.json'), JSON.stringify(tokens, null, 2))
}
