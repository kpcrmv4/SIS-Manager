import { createHmac } from 'node:crypto'
import { required } from './env'

/**
 * Signs a customer token the same way src/lib/customer/token.ts does — reimplemented here
 * (not imported) because that module pulls in 'server-only', which a Playwright test process
 * cannot load. Format: base64url(JSON {sub, br, exp}) + '.' + base64url(HMAC-SHA256(body, secret)).
 */
export function signCustomerToken(customerId: string, branchId: string, ttlSeconds = 60 * 60 * 12): string {
  const secret = Buffer.from(required('CUSTOMER_TOKEN_SECRET'))
  const body = Buffer.from(JSON.stringify({ sub: customerId, br: branchId, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url')
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}
