'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { backKey, backSnapshot, parseBack, subscribeTrail } from '@/lib/nav-trail'

/**
 * ‹ back (R-050): returns to the page the user came from, named after it — ‹ สแกน QR, ‹ คืนนี้ —
 * stepping back through the browser's history, so that page comes back as it was left (its search,
 * its filter, its open sheet). Opened directly, with nothing to go back to, it is a plain link to
 * the page's parent list.
 */
export function BackLink({ fallbackHref, fallbackLabel }: { fallbackHref: string; fallbackLabel: string }) {
  const pathname = usePathname()
  const t = useTranslations('back')
  const snapshot = useSyncExternalStore(
    subscribeTrail,
    () => backSnapshot(pathname),
    () => '',
  )
  const back = parseBack(snapshot)

  if (!back) {
    return (
      <Link href={fallbackHref} className="btn-ghost btn-sm mb-3" data-testid="back-link" data-back="parent">
        ‹ {fallbackLabel}
      </Link>
    )
  }
  return (
    <button
      type="button"
      className="btn-ghost btn-sm mb-3"
      onClick={() => window.history.go(-back.steps)}
      data-testid="back-link"
      data-back={back.path}
    >
      ‹ {t(backKey(back.path))}
    </button>
  )
}
