import { NextResponse, type NextRequest } from 'next/server'
import { getActorState } from '@/lib/auth/actor'
import { getAiConfig } from '@/lib/ai/config'
import { chipsFor, cleanPath } from '@/lib/ai/page'

export const runtime = 'nodejs'

/** R-070: the quick questions for the page the person has open and what is waiting right now. */
export async function GET(req: NextRequest) {
  const state = await getActorState()
  if (state.status !== 'ok') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const me = state.actor
  const config = await getAiConfig()
  if (!config.enabledRoles.includes(me.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!me.branch) return NextResponse.json({ chips: [] })
  const chips = await chipsFor(me.branch.id, me.role, cleanPath(req.nextUrl.searchParams.get('path')))
  return NextResponse.json({ chips }, { headers: { 'Cache-Control': 'no-store' } })
}
