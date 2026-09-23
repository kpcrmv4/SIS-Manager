'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { useLive } from '@/components/realtime/live-provider'

const REFRESH_DEBOUNCE_MS = 800
// what no broadcast announces: a print-server heartbeat going stale, the no-show cron
const TICK_MS = 120_000

/**
 * The overview spans every branch. LiveProvider already follows the working branch; this
 * follows the other active branches (the realtime policy lets the owner join them all) and
 * re-reads on a slow tick. A hidden tab refreshes once when it comes back.
 */
export function OverviewLive({ branchIds, working }: { branchIds: string[]; working: string | null }) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef(false)
  const [joined, setJoined] = useState(0)
  const others = branchIds
    .filter((id) => id !== working)
    .sort()
    .join(',')
  const total = others ? others.split(',').length : 0

  useEffect(() => {
    const sb = getSupabaseBrowser()
    const channels: RealtimeChannel[] = []
    let cancelled = false

    const refresh = () => {
      if (document.visibilityState !== 'visible') {
        pending.current = true
        return
      }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending.current) {
        pending.current = false
        router.refresh()
      }
    }

    void (async () => {
      if (!others) return
      const { data } = await sb.auth.getSession()
      if (cancelled || !data.session) return
      await sb.realtime.setAuth(data.session.access_token)
      if (cancelled) return
      for (const id of others.split(',')) {
        channels.push(
          sb
            .channel(`branch:${id}`, { config: { private: true } })
            .on('broadcast', { event: '*' }, refresh)
            .subscribe((status) => {
              if (status === 'SUBSCRIBED') setJoined((n) => n + 1)
            }),
        )
      }
    })()

    const tick = setInterval(refresh, TICK_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(tick)
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      setJoined(0)
      for (const ch of channels) void sb.removeChannel(ch)
    }
  }, [others, router])

  // specs wait for every other branch's channel before changing data there
  return <span hidden data-testid="overview-live-others" data-joined={joined} data-total={total} />
}

/** "สด" — green and pulsing once the working branch's channel is joined. */
export function LiveBadge({ label }: { label: string }) {
  const { joined } = useLive()
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-token" data-testid="overview-live" data-state={joined ? 'live' : 'connecting'}>
      <span className="relative flex size-2" aria-hidden>
        {joined && <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-done opacity-60 motion-reduce:hidden" />}
        <span className={`relative inline-flex size-2 rounded-full ${joined ? 'bg-status-done' : 'bg-muted-token'}`} />
      </span>
      {label}
    </span>
  )
}
