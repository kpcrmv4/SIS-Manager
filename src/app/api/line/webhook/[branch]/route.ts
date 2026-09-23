import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { verifyLineSignature } from '@/lib/line/signature'
import { handleWebhookEvents, type LineEvent } from '@/lib/line/webhook'

export const runtime = 'nodejs'

const MAX_BODY = 1024 * 1024

/**
 * LINE webhook for one branch OA (P3-A3): /api/line/webhook/<branch code, any case>.
 * Unknown branch → 404. No secret configured, or X-Line-Signature missing / not the HMAC of
 * the raw body with THIS branch's channel secret → 401 and nothing is written. After a valid
 * signature the answer is always 200 (LINE retries anything else), even if an event failed.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ branch: string }> }) {
  const { branch: code } = await params
  if (!/^[a-z]{2,5}$/i.test(code)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const admin = getSupabaseAdmin()
  const { data: branch, error } = await admin.from('branches').select('id, code, name, liff_id').eq('code', code.toUpperCase()).eq('active', true).maybeSingle()
  if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  if (!branch) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const raw = Buffer.from(await req.arrayBuffer())
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'too_large' }, { status: 413 })

  const { data: secrets, error: secretError } = await admin.from('branch_line_secrets').select('channel_secret, channel_access_token').eq('branch_id', branch.id).maybeSingle()
  if (secretError) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  if (!verifyLineSignature(raw, secrets?.channel_secret, req.headers.get('x-line-signature'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let events: LineEvent[] = []
  try {
    const body = JSON.parse(raw.toString('utf8')) as { events?: unknown }
    events = Array.isArray(body.events) ? (body.events as LineEvent[]) : []
  } catch {
    return NextResponse.json({ ok: true })
  }
  await handleWebhookEvents(branch, secrets?.channel_access_token ?? null, events)
  return NextResponse.json({ ok: true })
}
