'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { recordPath } from '@/lib/nav-trail'

/** Keeps the trail of pages BackLink falls back on where the browser has no Navigation API (R-050). */
export function NavTrail() {
  const pathname = usePathname()
  useEffect(() => {
    recordPath(pathname)
  }, [pathname])
  return null
}
