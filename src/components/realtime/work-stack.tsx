'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bell, BellRing, CalendarCheck, CalendarClock, CalendarMinus, ChevronDown, ClipboardCheck, GlassWater, MessageSquarePlus, X, type LucideIcon } from 'lucide-react'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { formatShortDate } from '@/lib/date'
import { alertSoundOn, chime, notificationParts } from '@/components/shell/notification-text'

export type StackItem = { id: string; kind: string; payload: Record<string, unknown> | null; link: string | null; created_at: string }

const STORE = 'sis_work_stack'
const MAX = 5
const QUIET_MS = 3000

const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  deposit_received: { icon: ClipboardCheck, tone: 'bg-status-progress-bg text-status-progress' },
  deposit_withdrawal_requested: { icon: GlassWater, tone: 'bg-status-violet-bg text-status-violet' },
  deposit_requested: { icon: MessageSquarePlus, tone: 'bg-status-info-bg text-status-info' },
  booking_pending: { icon: CalendarClock, tone: 'bg-status-progress-bg text-status-progress' },
  booking_new: { icon: CalendarCheck, tone: 'bg-status-info-bg text-status-info' },
  booking_cancelled: { icon: CalendarMinus, tone: 'bg-urgent-bg text-urgent' },
  test: { icon: BellRing, tone: 'bg-surface-2 text-ink-2' },
}

export function loadStack(): StackItem[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE) ?? '[]') as StackItem[]
    return Array.isArray(v) ? v.slice(0, MAX) : []
  } catch {
    return []
  }
}
export function keepStack(items: StackItem[]) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(items.slice(0, MAX)))
  } catch {
    // private mode: the stack lasts this page only
  }
}
export const pushStack = (prev: StackItem[], item: StackItem) => [item, ...prev.filter((x) => x.id !== item.id)].slice(0, MAX)

/** Busy = a dialog / sheet is open, a field has focus, or the screen was touched in the last 3 s. */
function isBusy(lastTouch: number): boolean {
  if (document.visibilityState !== 'visible') return true
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return true
  const a = document.activeElement as HTMLElement | null
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true
  return Date.now() - lastTouch < QUIET_MS
}

/**
 * R-078 (owner, 2026-09-28) — new work waits in a small stack instead of a toast that leaves after
 * six seconds. It shows only to someone who is free: the page in view, no dialog or sheet open,
 * no field in use, the screen untouched for 3 s — until then the work queues (the bell still
 * counts it). One card, the newest on top, "+N" opens the rest; it stays until opened or closed,
 * and leaves by itself once someone else has done the work (R-077). The chime and vibration play
 * when it shows, not while the person is busy.
 */
export function WorkStack({ items, setItems, tick }: { items: StackItem[]; setItems: (fn: (prev: StackItem[]) => StackItem[]) => void; tick: number }) {
  const t = useTranslations('bell')
  const tw = useTranslations('workStack')
  const router = useRouter()
  const [free, setFree] = useState(false)
  const [open, setOpen] = useState(false)
  // ids already shown to this person — once up, the card stays (it only steps aside for a dialog)
  const [seen, setSeen] = useState<string[]>([])
  const lastTouch = useRef(0)

  // watch for "free" only while something is waiting
  useEffect(() => {
    if (!items.length) return
    const touch = () => {
      lastTouch.current = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    for (const e of events) window.addEventListener(e, touch, { passive: true })
    const check = () => {
      const f = !isBusy(lastTouch.current)
      setFree(f)
      if (!f) return
      const fresh = items.filter((i) => !seen.includes(i.id))
      if (!fresh.length) return
      setSeen((prev) => [...prev, ...fresh.map((i) => i.id)].slice(-50))
      // shown for the first time → one chime and a short buzz
      if (alertSoundOn()) chime()
      navigator.vibrate?.(120)
    }
    const id = window.setInterval(check, 700)
    return () => {
      for (const e of events) window.removeEventListener(e, touch)
      window.clearInterval(id)
    }
  }, [items, seen])

  // work done elsewhere (or read in the bell) leaves the stack
  useEffect(() => {
    if (!items.length) return
    let live = true
    void getSupabaseBrowser()
      .from('notifications')
      .select('id, read_at, handled_at')
      .in(
        'id',
        items.map((i) => i.id),
      )
      .then(({ data, error }) => {
        if (!live || error || !data) return
        const gone = new Set(data.filter((r) => r.read_at || r.handled_at).map((r) => r.id))
        if (gone.size) setItems((prev) => prev.filter((i) => !gone.has(i.id)))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const dismiss = useCallback(
    (ids: string[]) => {
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)))
      void getSupabaseBrowser().from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null)
    },
    [setItems],
  )

  if (!items.length) return null
  // up when free; once seen it stays up — stepping aside only while a dialog is open
  const dialogOpen = typeof document !== 'undefined' && !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
  const allSeen = items.every((i) => seen.includes(i.id))
  if (!free && !(allSeen && !dialogOpen)) return null

  const [top, ...rest] = items
  const row = (it: StackItem, main: boolean) => {
    const look = LOOK[it.kind] ?? { icon: Bell, tone: 'bg-surface-2 text-ink-2' }
    const { title, lines } = notificationParts(t as never, it.kind, it.payload, (ymd) => formatShortDate(`${ymd}T00:00:00+07:00`))
    return (
      <div className="flex items-start gap-3" data-testid={main ? 'work-stack-top' : 'work-stack-row'} data-kind={it.kind}>
        <span className={`flex size-9 flex-none items-center justify-center rounded-[10px] ${look.tone}`} aria-hidden>
          <look.icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-5 text-ink">{title}</p>
          {lines.map((l, i) => (
            <p key={i} className="truncate text-[13px] leading-5 text-ink-2">
              {l}
            </p>
          ))}
        </div>
        <div className="flex flex-none flex-col items-end gap-1.5">
          <button type="button" className="btn-ghost btn-sm -mr-1.5 -mt-1" onClick={() => dismiss([it.id])} aria-label={tw('dismiss')} data-testid="work-stack-dismiss">
            <X className="size-4" aria-hidden />
          </button>
          {it.link && (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => {
                dismiss([it.id])
                router.push(it.link!)
              }}
              data-testid="work-stack-open"
            >
              {t('open')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-[calc(64px+env(safe-area-inset-top,0px))] z-25 rounded-2xl border border-line bg-card p-3 shadow-e2 motion-safe:animate-[ai-in_240ms_ease-out] nav:inset-x-auto nav:bottom-6 nav:right-6 nav:top-auto nav:w-[380px]"
      data-testid="work-stack"
      data-count={items.length}
    >
      {row(top, true)}
      {rest.length > 0 && (
        <>
          <div className="mt-2 flex items-center justify-between border-t border-line-soft pt-2">
            <button type="button" className="btn-ghost btn-sm -ml-1.5" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="work-stack-more">
              <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
              {tw('more', { count: rest.length })}
            </button>
            <button type="button" className="btn-ghost btn-sm -mr-1.5 text-muted-token" onClick={() => dismiss(items.map((i) => i.id))} data-testid="work-stack-clear">
              {tw('clearAll')}
            </button>
          </div>
          {open && (
            <div className="mt-1 flex max-h-[45vh] flex-col gap-3 overflow-y-auto border-t border-line-soft pt-3">
              {rest.map((it) => (
                <div key={it.id}>{row(it, false)}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
