'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Printer } from 'lucide-react'
import { StatusDot, type BadgeTone } from '@/components/ui/badge'
import { getPrintStatus, type PrintStatusView } from '@/lib/print/actions'

const TONE: Record<PrintStatusView['state'], BadgeTone> = { online: 'done', offline: 'urgent', not_set_up: 'pending' }

/**
 * Compact, read-only print-station indicator. Used both standalone (staff/bar on the
 * deposit detail, next to the print buttons) and above the job list in the owner's
 * settings panel. No realtime (P4-02) — `refreshKey` bumps to refetch after an action.
 */
export function PrintStatusBadge({ branchId, refreshKey = 0 }: { branchId: string; refreshKey?: number }) {
  const t = useTranslations('print')
  const [state, setState] = useState<PrintStatusView['state'] | null>(null)

  useEffect(() => {
    let alive = true
    getPrintStatus(branchId).then((res) => {
      if (!alive) return
      setState(res.ok ? res.data.state : 'not_set_up')
    })
    return () => {
      alive = false
    }
  }, [branchId, refreshKey])

  if (state === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-token" data-testid="print-status-badge">
        <Printer className="size-4 animate-pulse" aria-hidden />
        {t('checking')}
      </span>
    )
  }

  const label = state === 'online' ? t('online') : state === 'offline' ? t('offline') : t('notSetUp')
  return (
    <span data-testid="print-status-badge" data-state={state}>
      <StatusDot tone={TONE[state]}>{label}</StatusDot>
    </span>
  )
}
