import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ListRow } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/states'
import type { Translator } from '@/lib/deposit/format'
import { formatShortDate, type AppLocale } from '@/lib/date'
import { branchHref } from '@/lib/reports/dashboard-view'
import type { RecentDisposal } from '@/lib/reports/overview'
import { Block } from './block'

/** The latest disposals across branches, with who did it and whether the customer was told on LINE. */
export function DisposalList({
  items,
  t,
  disposedLabel,
  locale,
  working,
  showBranch,
  className = '',
}: {
  items: RecentDisposal[]
  t: Translator
  disposedLabel: string
  locale: AppLocale
  working: string | null
  showBranch: boolean
  className?: string
}) {
  return (
    <Block title={t('recentDisposals')} className={className} bodyClassName="" testId="overview-disposals-block">
      {items.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={Trash2} message={t('noDisposals')} />
        </div>
      ) : (
        <div data-testid="overview-disposals">
          {items.map((d) => (
            <ListRow
              key={d.id}
              href={d.branch_id ? branchHref(d.branch_id, `/deposits/${d.id}`, working) : `/deposits/${d.id}`}
              title={[d.item, d.customer, showBranch ? d.branch : null].filter(Boolean).join(' · ')}
              meta={
                <span className="tnum">
                  {t('disposalMeta', {
                    expired: d.expires_at ? formatShortDate(d.expires_at, locale) : '—',
                    disposed: d.disposed_at ? formatShortDate(d.disposed_at, locale) : '—',
                    by: d.by ?? '—',
                  })}
                  {d.notified && ` · ${t('lineNotified')}`}
                </span>
              }
              aside={<Badge tone="urgent">{disposedLabel}</Badge>}
            />
          ))}
        </div>
      )}
    </Block>
  )
}
