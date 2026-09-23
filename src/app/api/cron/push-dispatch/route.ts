import { NextResponse, type NextRequest } from 'next/server'
import { isCronRequest } from '@/lib/cron-auth'
import { dispatchPush } from '@/lib/push/dispatch'

export const runtime = 'nodejs'

/** Web-push dispatcher, pinged by pg_cron every minute (P4-03). */
export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await dispatchPush())
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
