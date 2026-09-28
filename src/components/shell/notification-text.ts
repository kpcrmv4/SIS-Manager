import { textKind } from '@/lib/push/kinds'

type T = (key: string, values?: Record<string, string>) => string

/** One notification row as a line of text — the bell list and the live toast say it the same way. */
export function notificationText(t: T, kind: string, payload: Record<string, unknown> | null): string {
  const p = payload ?? {}
  const v = (k: string) => (p[k] == null ? '' : String(p[k]))
  return t(`kinds.${textKind(kind)}`, { item: v('item'), customer: v('customer'), table: v('table') || '—', name: v('name'), party: v('party'), time: v('time'), code: v('code') })
}

const SOUND_KEY = 'sis_alert_sound'

/** The alert sound for a new job is this device's choice, off until turned on. */
export function alertSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on'
  } catch {
    return false
  }
}

export function setAlertSound(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    // private mode: the choice lasts this page only
  }
}

/** A short two-tone chime from the Web Audio API — no file to load; silent where audio is blocked. */
export function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tone = (freq: number, at: number) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + at)
      o.stop(ctx.currentTime + at + 0.25)
    }
    tone(880, 0)
    tone(1175, 0.16)
    window.setTimeout(() => void ctx.close(), 800)
  } catch {
    // audio unavailable: the toast and the vibration still say it
  }
}

/**
 * Android counts a web app's icon badge from its notifications still in the shade, so read ones
 * must leave it too (owner, 2026-09-28): close the system notifications of these rows (their tag is
 * the row id), or all of this app's when no ids are given.
 */
export function clearSystemNotifications(ids?: string[]): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker
    .getRegistration()
    .then(async (reg) => {
      if (!reg) return
      const shown = await reg.getNotifications()
      for (const n of shown) if (!ids || ids.includes(n.tag)) n.close()
    })
    .catch(() => undefined)
}
