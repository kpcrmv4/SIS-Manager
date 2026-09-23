'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabaseBrowser } from '@/lib/supabase/browser'

/**
 * P4-02 — one realtime connection per staff tab.
 *  - `branch:<id>` (private): deposits / withdrawals / bookings changed in the working
 *    branch → refresh the server-rendered page, debounced, and only while the tab is
 *    visible (a hidden tab refreshes once when it comes back).
 *  - `user:<id>` (private): a notification row for me → bump the bell.
 * The realtime.messages policy decides who may join each topic (P1 migrations).
 */
type LiveCtx = { unread: number; refreshUnread: () => void; notificationTick: number }
const Ctx = createContext<LiveCtx>({ unread: 0, refreshUnread: () => undefined, notificationTick: 0 })
export const useLive = () => useContext(Ctx)

const REFRESH_DEBOUNCE_MS = 800

export function LiveProvider({ userId, branchId, children }: { userId: string; branchId: string | null; children: ReactNode }) {
  const router = useRouter()
  const [unread, setUnread] = useState(0)
  const [notificationTick, setNotificationTick] = useState(0)
  const [joined, setJoined] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef(false)

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
    const sb = getSupabaseBrowser()
    const channels: RealtimeChannel[] = []
    let cancelled = false

    void (async () => {
      const { data } = await sb.auth.getSession()
      if (cancelled || !data.session) return
      await sb.realtime.setAuth(data.session.access_token)
      if (cancelled) return
      if (branchId) {
        channels.push(
          sb
            .channel(`branch:${branchId}`, { config: { private: true } })
            .on('broadcast', { event: '*' }, scheduleRefresh)
            .subscribe((status) => {
              if (status === 'SUBSCRIBED') setJoined(true)
            }),
        )
      }
      channels.push(
        sb
          .channel(`user:${userId}`, { config: { private: true } })
          .on('broadcast', { event: 'notification' }, () => {
            refreshUnread()
            setNotificationTick((n) => n + 1)
          })
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
      clearTimeout(timer.current)
      for (const ch of channels) void sb.removeChannel(ch)
    }
  }, [branchId, userId, scheduleRefresh, refreshUnread])

  return (
    <Ctx.Provider value={{ unread, refreshUnread, notificationTick }}>
      {/* data-live: specs wait for the branch channel before changing data */}
      <div data-live={joined ? 'joined' : 'connecting'} className="contents">
        {children}
      </div>
    </Ctx.Provider>
  )
}
