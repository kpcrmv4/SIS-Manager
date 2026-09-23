'use client'

import { useEffect } from 'react'

/** Registers /sw.js — mounted in the staff layout only, never on /liff (P4-03). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  }, [])
  return null
}
