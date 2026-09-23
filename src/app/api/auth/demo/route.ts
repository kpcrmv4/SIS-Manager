import { NextResponse, type NextRequest } from 'next/server'
import { DEMO_ROLES, DEMO_USERNAME, demoLoginEnabled, demoPassword } from '@/lib/auth/demo'
import { usernameEmail } from '@/lib/auth/identifier'
import { signInWithPassword } from '@/lib/auth/sign-in'

export const runtime = 'nodejs'

/** One-tap demo login. 404 (not 403) when the kill switch is off: a 403 confirms the route exists. */
export async function POST(req: NextRequest) {
  if (!demoLoginEnabled()) return new NextResponse(null, { status: 404 })

  let role: unknown
  try {
    role = ((await req.json()) as { role?: unknown })?.role
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  if (typeof role !== 'string' || !(DEMO_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  const r = role as (typeof DEMO_ROLES)[number]
  const password = demoPassword(r)
  if (!password) return NextResponse.json({ error: 'unavailable' }, { status: 503 })

  const result = await signInWithPassword(req, usernameEmail(DEMO_USERNAME[r]), password)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return result.response
}
