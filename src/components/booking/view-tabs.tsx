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
    // the list first — it is the default view (owner, 2026-09-27)
    <div className="tabs shrink-0" role="tablist" aria-label={planLabel}>
      <Link href={hrefWith('/bookings', params, { view: 'list' })} className="tab px-3!" aria-selected={view === 'list'} role="tab">
        {listLabel}
      </Link>
      <Link href={hrefWith('/bookings', params, { view: 'plan' })} className="tab px-3!" aria-selected={view === 'plan'} role="tab">
        {planLabel}
      </Link>
    </div>
  )
}
