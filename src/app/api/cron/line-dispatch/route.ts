import { NextResponse, type NextRequest } from 'next/server'
import { isCronRequest } from '@/lib/cron-auth'

export const runtime = 'nodejs'

/** LINE outbox dispatcher, pinged by pg_cron every minute (skeleton — P3-A2 sends). */
export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ error: 'not_implemented', task: 'P3-A2' }, { status: 501 })
}
