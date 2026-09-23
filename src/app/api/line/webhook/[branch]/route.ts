import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

/**
 * LINE webhook for one branch's OA (skeleton — P3-A3 verifies X-Line-Signature with the
 * branch channel secret and handles the DEP-code link flow). Refuses everything until then:
 * a webhook must never run without a verified signature.
 */
export async function POST(req: NextRequest) {
  if (!req.headers.get('x-line-signature')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ error: 'not_implemented', task: 'P3-A3' }, { status: 501 })
}
