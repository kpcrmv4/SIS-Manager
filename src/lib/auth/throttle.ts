import 'server-only'
import type { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Sign-in happens on our server, so Supabase Auth sees one IP for every staff
 * member — its own limiter would let one attacker lock out the whole shop. This
 * counter is keyed on the real client IP and on the identifier.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  return (fwd?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim().slice(0, 64) || 'unknown'
}

export async function isThrottled(ip: string, identifier: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc('login_throttle', { p_ip: ip, p_identifier: identifier })
  // Fail open on a limiter outage: Supabase Auth's own limit still applies.
  if (error) return false
  return data === true
}

export async function recordAttempt(ip: string, identifier: string, ok: boolean): Promise<void> {
  await getSupabaseAdmin().rpc('login_record', { p_ip: ip, p_identifier: identifier, p_ok: ok })
}
