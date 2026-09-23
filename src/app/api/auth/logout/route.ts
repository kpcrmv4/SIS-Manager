import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseForResponse } from '@/lib/supabase/route'

export const runtime = 'nodejs'

/** Ends this device's session only (scope 'local'); the client then location.replace('/login'). */
export async function POST(req: NextRequest) {
  const response = NextResponse.json({ ok: true })
  const supabase = getSupabaseForResponse(req, response)
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  // No session is not an error for logout: the goal state is reached either way.
  if (error && error.status !== 401 && error.status !== 403) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
  return response
}
