'use client'

import { useSyncExternalStore } from 'react'

/**
 * A shared ticking clock. Returns null during SSR and hydration so the first client
 * render matches the server HTML (time-derived text like "late 5 min" would otherwise
 * mismatch), then the current time, refreshed every 30 s.
 */
const TICK_MS = 30_000
const listeners = new Set<() => void>()
let current = Date.now()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (!timer) {
    current = Date.now()
    timer = setInterval(() => {
      current = Date.now()
      listeners.forEach((l) => l())
    }, TICK_MS)
  }
  return () => {
    listeners.delete(onChange)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

export function useNow(): number | null {
  return useSyncExternalStore<number | null>(
    subscribe,
    () => current,
    () => null,
  )
}
