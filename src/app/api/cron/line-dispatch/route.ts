import { NextResponse, type NextRequest } from 'next/server'
import { isCronRequest } from '@/lib/cron-auth'
import { dispatchOutbox } from '@/lib/line/dispatch'

export const runtime = 'nodejs'
export const maxDuration = 60

/** LINE outbox dispatcher, pinged by pg_cron every minute (P3-A2). Refuses before touching a row. */
export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const summary = await dispatchOutbox()
    return NextResponse.json({ ok: true, ...summary })
  } catch {
    return NextResponse.json({ error: 'dispatch_failed' }, { status: 503 })
  }
}
