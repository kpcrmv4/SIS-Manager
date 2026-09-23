import Link from 'next/link'
import { Hourglass } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import type { Translator } from '@/lib/deposit/format'
import { daysUntil, formatShortDate, type AppLocale } from '@/lib/date'
import { branchHref, type ExpiringItem } from '@/lib/reports/dashboard-view'
import { Block } from './block'

/** The soonest expiries inside each branch's notice window — the bottles about to be lost. */
export function ExpiringList({
  items,
  total,
  t,
  locale,
  working,
  showBranch,
  now,
  className = '',
}: {
  items: ExpiringItem[]
  total: number
  t: Translator
  locale: AppLocale
  working: string | null
  showBranch: boolean
  /** the snapshot's time (owner_dashboard.generated_at) — render stays pure */
  now: Date
  className?: string
}) {
  return (
    <Block
      id="overview-expiring"
      title={t('expiringTitle')}
      aside={total > 0 ? <span className="tnum">{t('bottles', { count: total })}</span> : null}
      className={className}
      bodyClassName=""
      testId="overview-expiring"
    >
      {items.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={Hourglass} message={t('expiringEmpty')} />
        </div>
      ) : (
        <ul>
          {items.map((d) => {
            const days = daysUntil(d.expires_at, now)
            const past = new Date(d.expires_at).getTime() < now.getTime()
            return (
              <li key={d.id} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={branchHref(d.branch_id, `/deposits/${d.id}`, working)}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-surface-2"
                  data-testid="expiring-item"
                  data-code={d.code}
                  data-notified={d.notified}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {d.item} · {d.customer}
                    </span>
                    <span className="block truncate text-xs text-muted-token tnum">
                      {[d.code, formatShortDate(d.expires_at, locale), t('bottles', { count: d.remaining }), showBranch ? d.branch : null].filter(Boolean).join(' · ')}
                      {d.notified && ` · ${t('lineNotified')}`}
                    </span>
                  </span>
                  <Badge tone={past || days <= 1 ? 'urgent' : 'progress'}>{past ? t('expiredAlready') : t('daysLeft', { count: Math.max(0, days) })}</Badge>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Block>
  )
}
