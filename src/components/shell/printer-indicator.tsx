'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Printer } from 'lucide-react'
import { getPrintState } from '@/lib/print/actions'
import type { PrintStatusView } from '@/lib/print/actions'

type State = PrintStatusView['state'] | 'error' | null

const POLL_MS = 60_000
const DOT: Record<Exclude<State, null>, string> = {
  online: 'bg-status-done',
  offline: 'bg-urgent',
  not_set_up: 'bg-muted-token',
  error: 'bg-muted-token',
}

/**
 * Top-bar printer icon with a status dot (green online · red offline · grey not set up).
 * Polls the heartbeat every minute and when the tab comes back. Owner: links to the print
 * settings; staff/bar: the tooltip is the status.
 */
export function PrinterIndicator({ branchId, className, owner }: { branchId: string; className: string; owner: boolean }) {
  const t = useTranslations('print')
  const [state, setState] = useState<State>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      getPrintState(branchId)
        .then((res) => alive && setState(res.ok ? res.data : 'error'))
        .catch(() => alive && setState('error'))
    void load()
    const id = window.setInterval(load, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [branchId])

  const text =
    state === null ? t('checking') : state === 'error' ? t('statusError') : state === 'online' ? t('online') : state === 'offline' ? t('offline') : t('notSetUp')
  const label = `${t('statusTitle')}: ${text}`
  const body = (
    <>
      <Printer className="size-5" aria-hidden />
      {state && <span className={`absolute right-2 top-2 size-2.5 rounded-full ring-2 ring-canvas ${DOT[state]}`} aria-hidden />}
    </>
  )
  const common = { className: `relative ${className}`, 'aria-label': label, title: label, 'data-testid': 'printer-indicator', 'data-state': state ?? 'loading' }

  return owner ? (
    <Link href="/settings/branch#print" {...common}>
      {body}
    </Link>
  ) : (
    <span role="img" {...common}>
      {body}
    </span>
  )
}
