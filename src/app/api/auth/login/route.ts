import { NextResponse, type NextRequest } from 'next/server'
import { identifierToEmail } from '@/lib/auth/identifier'
import { signInWithPassword } from '@/lib/auth/sign-in'
import { clientIp, isThrottled, recordAttempt } from '@/lib/auth/throttle'

export const runtime = 'nodejs'

const MAX_BODY = 2048

export async function POST(req: NextRequest) {
  const text = await req.text()
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'invalid' }, { status: 413 })

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  const { identifier, password } = (body ?? {}) as { identifier?: unknown; password?: unknown }
  if (typeof identifier !== 'string' || typeof password !== 'string' || !password || password.length > 128) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  const ip = clientIp(req)
  const key = identifier.trim().toLowerCase().slice(0, 254)
  if (await isThrottled(ip, key)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const email = identifierToEmail(identifier)
  // Same answer as a wrong password: the form must not reveal which accounts exist.
  if (!email) {
    await recordAttempt(ip, key, false)
    return NextResponse.json({ error: 'invalid' }, { status: 401 })
  }

  const result = await signInWithPassword(req, email, password)
  if (result.ok || result.error === 'invalid' || result.error === 'inactive') await recordAttempt(ip, key, result.ok)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return result.response
}
