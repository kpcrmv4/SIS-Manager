import Link from 'next/link'
import { hrefWith } from '@/components/ui/filter-href'

/** ผังโต๊ะ ↔ รายการ — `?view=`, server-rendered (no client JS needed for a link toggle). */
export function ViewTabs({
  view,
  params,
  planLabel,
  listLabel,
}: {
  view: 'plan' | 'list'
  params: Record<string, string | undefined>
  planLabel: string
  listLabel: string
}) {
  return (
    <div className="tabs mb-4" role="tablist" aria-label={planLabel}>
      <Link href={hrefWith('/bookings', params, { view: 'plan' })} className="tab" aria-selected={view === 'plan'} role="tab">
        {planLabel}
      </Link>
      <Link href={hrefWith('/bookings', params, { view: 'list' })} className="tab" aria-selected={view === 'list'} role="tab">
        {listLabel}
      </Link>
    </div>
  )
}
