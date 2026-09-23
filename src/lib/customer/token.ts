import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * A short-lived customer token, so a LIFF page that already proved its LINE identity
 * does not call LINE's API on every request. HMAC-SHA256 with CUSTOMER_TOKEN_SECRET —
 * there is deliberately no fallback secret: missing configuration refuses every token.
 */
export type CustomerClaims = { sub: string; br: string; exp: number }

function secret(): Buffer {
  const s = process.env.CUSTOMER_TOKEN_SECRET
  if (!s || s.length < 32) throw new Error('CUSTOMER_TOKEN_SECRET is not configured')
  return Buffer.from(s)
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export function signCustomerToken(customerId: string, branchId: string, ttlSeconds = 60 * 60 * 12): string {
  const body = b64(JSON.stringify({ sub: customerId, br: branchId, exp: Math.floor(Date.now() / 1000) + ttlSeconds } satisfies CustomerClaims))
  const sig = b64(createHmac('sha256', secret()).update(body).digest())
  return `${body}.${sig}`
}

export function verifyCustomerToken(token: string | null | undefined): CustomerClaims | null {
  if (!token || token.length > 1024) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  let expected: Buffer
  try {
    expected = createHmac('sha256', secret()).update(body).digest()
  } catch {
    return null
  }
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CustomerClaims
    if (typeof claims.sub !== 'string' || typeof claims.br !== 'string' || typeof claims.exp !== 'number') return null
    if (claims.exp < Math.floor(Date.now() / 1000)) return null
    return claims
  } catch {
    return null
  }
}
