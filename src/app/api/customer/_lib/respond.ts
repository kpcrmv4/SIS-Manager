import 'server-only'
import { NextResponse } from 'next/server'
import { dbErrorCode, type DbErrorCode } from '@/lib/errors'

/** Most RPC failures are the customer's own request being stale/invalid (400); a few read as 403/404/503. */
function statusFor(code: DbErrorCode): 400 | 403 | 404 | 503 {
  if (code === 'FORBIDDEN' || code === 'NOT_YOURS') return 403
  if (code === 'NOT_FOUND') return 404
  if (code === 'unknown') return 503
  return 400
}

/** Turns a Supabase/PostgREST error from an RPC call into the `{ error: CODE }` shape the LIFF UI expects. */
export function rpcError(error: { message?: string; code?: string } | null | undefined): NextResponse {
  const code = dbErrorCode(error)
  return NextResponse.json({ error: code }, { status: statusFor(code) })
}
