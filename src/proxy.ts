import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // sw.js + manifest stay outside the gate: a 307 on /sw.js kills PWA install
  // and web push for logged-out visitors.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|fonts/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|ttf|woff2?)$).*)',
  ],
}
