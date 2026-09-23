import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase/server'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env'

export const runtime = 'nodejs'

/**
 * Self-service password change. A session is not proof the holder knows the
 * password (demo login, shared phone), so the current password is verified
 * server-side first — with a throwaway client that never touches cookies.
 * Order: who (401) before what (400/422).
 */
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { current?: unknown; next?: unknown } | null
  const current = body?.current
  const next = body?.next
  if (typeof current !== 'string' || typeof next !== 'string' || current.length > 128 || next.length > 128) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  if (next.length < 8) return NextResponse.json({ error: 'too_short' }, { status: 422 })

  const probe = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: verifyError } = await probe.auth.signInWithPassword({ email: userData.user.email, password: current })
  if (verifyError) {
    return NextResponse.json({ error: verifyError.status === 429 ? 'rate_limited' : 'wrong_password' }, { status: verifyError.status === 429 ? 429 : 403 })
  }
  await probe.auth.signOut({ scope: 'local' })

  const { error } = await supabase.auth.updateUser({ password: next })
  if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  return NextResponse.json({ ok: true })
}
