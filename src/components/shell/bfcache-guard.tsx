'use client'

import { useEffect } from 'react'

/**
 * After logout, Back can restore a staff page without asking the server —
 * from the back-forward cache (pageshow.persisted) or, in dev where Next sends
 * no `no-store`, from the HTTP cache (navigation type "back_forward"). Either
 * way the signed-out user would see the old page, so reload once: the reload
 * goes through the proxy and lands on /login. In-app Back is a client-side
 * navigation and never triggers this.
 */
export function BfcacheGuard() {
  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type === 'back_forward') {
      window.location.reload()
      return
    }
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload()
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])
  return null
}
