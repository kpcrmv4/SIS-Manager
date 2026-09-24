'use client'

import { useEffect } from 'react'
// listens for the browser's install offer from the first staff page on (R-042)
import './install-prompt'

/** Registers /sw.js — mounted in the staff layout only, never on /liff (P4-03). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  }, [])
  return null
}
