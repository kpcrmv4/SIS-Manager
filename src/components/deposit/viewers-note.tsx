'use client'

import { useTranslations } from 'next-intl'
import { Users } from 'lucide-react'
import { useViewers } from '@/components/realtime/live-provider'

/**
 * R-066 · someone else has this deposit open right now — said before two people walk the same
 * bottle to the same table. From the branch topic's presence; nothing when you are alone.
 */
export function ViewersNote({ path }: { path: string }) {
  const t = useTranslations('deposit')
  const others = useViewers(path)
  if (!others.length) return null
  return (
    <p className="mb-3 flex items-center gap-2 rounded-lg bg-status-info-bg px-3 py-2 text-sm text-status-info" role="status" data-testid="deposit-viewers" data-count={others.length}>
      <Users className="size-4 flex-none" aria-hidden />
      <span className="min-w-0">{t('viewers', { names: others.map((o) => o.name).join(', ') })}</span>
    </p>
  )
}
