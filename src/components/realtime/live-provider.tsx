'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { clearSystemNotifications } from '@/components/shell/notification-text'
import { WorkStack, keepStack, loadStack, pushStack, type StackItem } from './work-stack'

/**
 * P4-02 — one realtime connection per staff tab.
 *  - `branch:<id>` (private): deposits / withdrawals / bookings changed in the working
 *    branch → refresh the server-rendered page, debounced, and only while the tab is
 *    visible (a hidden tab refreshes once when it comes back).
 *    R-066: 'print_job' / 'printer' on the same topic bump `printTick` instead (the printer icon
 *    and the jobs panel reload; a job that didn't print says so in a toast), and the topic carries
 *    presence — who is on which page — so a page can say someone else has it open.
 *  - `user:<id>` (private): a notification row for me → bump the bell, and (R-078) put it on the
 *    work stack, which shows it — with the chime and buzz — once the person is free.
 * The realtime.messages policy decides who may join each topic (P1 migrations, R-066).
 */
export type Viewer = { id: string; name: string }
type LiveCtx = {
  unread: number
  refreshUnread: () => void
  notificationTick: number
  joined: boolean
  printTick: number
  /** everyone else on the branch topic, by the page they are on */
  viewers: Record<string, Viewer[]>
}
const Ctx = createContext<LiveCtx>({ unread: 0, refreshUnread: () => undefined, notificationTick: 0, joined: false, printTick: 0, viewers: {} })
export const useLive = () => useContext(Ctx)

/** Other people who have `path` open right now (never yourself). */
export function useViewers(path: string): Viewer[] {
  return useContext(Ctx).viewers[path] ?? []
}

const REFRESH_DEBOUNCE_MS = 800
const TOAST_MS = 6000

/** The unread count on the icon of the installed app (R-042); a plain browser tab ignores it. */
function setIconCount(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (!nav.setAppBadge || !nav.clearAppBadge) return
  void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => undefined)
}

type PresenceMeta = { id: string; name: string; path: string }

export function LiveProvider({ userId, displayName, branchId, children }: { userId: string; displayName: string; branchId: string | null; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const tp = useTranslations('print')
  // null until the first count arrives — the icon is left alone until then
  const [unread, setUnread] = useState<number | null>(null)
  const [notificationTick, setNotificationTick] = useState(0)
  const [printTick, setPrintTick] = useState(0)
  const [joined, setJoined] = useState(false)
  const [presence, setPresence] = useState<PresenceMeta[]>([])
  // R-078: new work waiting to be seen; kept for this tab across pages
  const [stack, setStackState] = useState<StackItem[]>(() => (typeof window === 'undefined' ? [] : loadStack()))
  const setStack = useCallback((fn: (prev: StackItem[]) => StackItem[]) => {
    setStackState((prev) => {
      const next = fn(prev)
      keepStack(next)
      return next
    })
  }, [])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef(false)
  const branchChannel = useRef<RealtimeChannel | null>(null)
  const pathRef = useRef(pathname)
  // the handlers below live as long as the socket; they read these through refs
  const tpRef = useRef(tp)
  useEffect(() => {
    tpRef.current = tp
  }, [tp])

  const refreshUnread = useCallback(() => {
    void getSupabaseBrowser()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
      .then(({ count, error }) => {
        if (!error) setUnread(count ?? 0)
      })
  }, [userId])

  const scheduleRefresh = useCallback(() => {
    if (document.visibilityState !== 'visible') {
      pending.current = true
      return
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS)
  }, [router])

  /** A new notification: the bell, and the work stack (R-078) — it shows once the person is free. */
  const announce = useCallback(
    (id: string) => {
      refreshUnread()
      setNotificationTick((n) => n + 1)
      void getSupabaseBrowser()
        .from('notifications')
        .select('id, kind, payload, link, created_at')
        .eq('id', id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error || !data) return
          setStack((prev) => pushStack(prev, { ...data, payload: data.payload as Record<string, unknown> | null }))
        })
    },
    [refreshUnread, setStack],
  )

  useEffect(() => {
    refreshUnread()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending.current) {
        pending.current = false
        router.refresh()
        refreshUnread()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshUnread, router])

  useEffect(() => {
    if (unread !== null) setIconCount(unread)
    // nothing unread: nothing of ours left in the shade either — Android's icon count follows it
    if (unread === 0) clearSystemNotifications()
  }, [unread])

  // presence follows the page this tab is on
  useEffect(() => {
    pathRef.current = pathname
    void branchChannel.current?.track({ id: userId, name: displayName, path: pathname })
  }, [pathname, userId, displayName])

  useEffect(() => {
    const sb = getSupabaseBrowser()
    const channels: RealtimeChannel[] = []
    let cancelled = false

    void (async () => {
      const { data } = await sb.auth.getSession()
      if (cancelled || !data.session) return
      await sb.realtime.setAuth(data.session.access_token)
      if (cancelled) return
      if (branchId) {
        const ch = sb.channel(`branch:${branchId}`, { config: { private: true, presence: { key: userId } } })
        ch.on('broadcast', { event: '*' }, (msg) => {
          if (msg.event === 'print_job' || msg.event === 'printer') {
            setPrintTick((n) => n + 1)
            const p = (msg.payload ?? {}) as { status?: string; code?: string | null; type?: string }
            if (msg.event === 'print_job' && p.status === 'failed' && document.visibilityState === 'visible') {
              toast.error(tpRef.current('jobFailedToast', { code: p.code ?? '' }), { duration: TOAST_MS })
            }
            return
          }
          scheduleRefresh()
          // R-077: a deposit / withdrawal / booking changed — its notifications may now read "done"
          refreshUnread()
          setNotificationTick((n) => n + 1)
        })
          .on('presence', { event: 'sync' }, () => {
            const state = ch.presenceState<PresenceMeta>()
            setPresence(Object.values(state).flatMap((metas) => metas.slice(-1)))
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              setJoined(true)
              void ch.track({ id: userId, name: displayName, path: pathRef.current })
            }
          })
        branchChannel.current = ch
        channels.push(ch)
      }
      channels.push(
        sb
          .channel(`user:${userId}`, { config: { private: true } })
          .on('broadcast', { event: 'notification' }, (msg) => announce(String((msg.payload as { id?: string } | undefined)?.id ?? '')))
          .subscribe(),
      )
    })()

    // the access token refreshes about hourly — hand each new one to the open socket, or the
    // private channels silently stop delivering after the first hour of a shift
    const { data: authSub } = sb.auth.onAuthStateChange((_event, session) => {
      if (session) void sb.realtime.setAuth(session.access_token)
    })

    return () => {
      cancelled = true
      authSub.subscription.unsubscribe()
      setJoined(false)
      setPresence([])
      branchChannel.current = null
      clearTimeout(timer.current)
      for (const ch of channels) void sb.removeChannel(ch)
    }
  }, [branchId, userId, displayName, scheduleRefresh, announce, refreshUnread])

  const viewers = useMemo(() => {
    const out: Record<string, Viewer[]> = {}
    for (const m of presence) {
      if (!m?.path || m.id === userId) continue
      const list = (out[m.path] ??= [])
      if (!list.some((v) => v.id === m.id)) list.push({ id: m.id, name: m.name })
    }
    return out
  }, [presence, userId])

  return (
    <Ctx.Provider value={{ unread: unread ?? 0, refreshUnread, notificationTick, joined, printTick, viewers }}>
      {/* data-live: specs wait for the branch channel before changing data */}
      <div data-live={joined ? 'joined' : 'connecting'} className="contents">
        {children}
      </div>
      <WorkStack items={stack} setItems={setStack} tick={notificationTick} />
    </Ctx.Provider>
  )
}
