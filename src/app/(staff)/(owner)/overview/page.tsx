import { getTranslations } from 'next-intl/server'
import { Download, FileText } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { MetricBar, Metric } from '@/components/ui/metric'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { ListRow } from '@/components/ui/list-row'
import { SegmentedFilter } from '@/components/ui/filter-bar'
import { getActorState } from '@/lib/auth/actor'
import { formatLongDate, formatShortDate, formatTime } from '@/lib/date'
import { getOverview, parsePeriod, periodRange, showRate, type OverviewBranch } from '@/lib/reports/overview'

type Search = Promise<{ period?: string }>

/** Owner landing (P4-01): KPIs across every branch, a per-branch table, latest disposals. */
export default async function OverviewPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const { from, to } = periodRange(period)
  const [t, tc, ts, state, data] = await Promise.all([
    getTranslations('overview'),
    getTranslations('common'),
    getTranslations('status'),
    getActorState(),
    getOverview(from, to),
  ])
  const locale = state.status === 'ok' ? state.actor.locale : 'th'
  const now = new Date()
  const k = data.kpi
  const rate = showRate(k.arrived, k.no_shows)
  const exportHref = (format: 'xlsx' | 'pdf') => `/api/reports/export?format=${format}&from=${from}&to=${to}`

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { date: formatLongDate(now, locale), time: formatTime(now, locale) })}
        action={
          <>
            <a className="btn-ghost" href={exportHref('xlsx')} data-testid="overview-export-xlsx">
              <Download className="size-4" aria-hidden />
              {t('exportExcel')}
            </a>
            <a className="btn-ghost" href={exportHref('pdf')} data-testid="overview-export-pdf">
              <FileText className="size-4" aria-hidden />
              {t('exportPdf')}
            </a>
          </>
        }
      />

      <div className="mb-4 max-w-md">
        <SegmentedFilter
          basePath="/overview"
          params={{ period: sp.period }}
          name="period"
          value={period}
          label={t('periodLabel')}
          options={[
            { value: 'month', label: t('periodThisMonth') },
            { value: 'last', label: t('periodLastMonth') },
            { value: '30', label: t('period30') },
          ]}
        />
      </div>

      <MetricBar>
        <Metric label={t('kpiInStore')} value={k.in_store_bottles} hint={t('kpiInStoreHint', { branches: k.branches, customers: k.in_store_customers })} />
        <Metric label={t('kpiNew')} value={k.new_deposits} hint={t('kpiNewHint', { count: k.bottles_withdrawn })} />
        <Metric label={t('kpiDisposed')} value={k.disposed} hint={t('kpiDisposedHint', { count: k.awaiting_disposal })} tone="urgent" />
        <Metric label={t('kpiShowRate')} value={rate === null ? '—' : `${rate}%`} hint={t('kpiShowRateHint', { bookings: k.bookings, noShows: k.no_shows })} tone="done" />
      </MetricBar>

      <h2 className="sec-head">{t('byBranch')}</h2>
      {data.branches.length === 0 ? (
        <EmptyState message={t('noBranches')} />
      ) : (
        <>
          <div className="panel hidden overflow-x-auto nav:block" data-testid="overview-branches-desktop">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('colBranch')}</th>
                  <th>{t('colInStore')}</th>
                  <th>{t('colToConfirm')}</th>
                  <th>{t('colExpiring')}</th>
                  <th>{t('colToDispose')}</th>
                  <th>{t('colBookingsTonight')}</th>
                  <th>{t('colArrived')}</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {data.branches.map((b) => (
                  <tr key={b.id} data-testid="overview-branch-row" data-branch={b.code}>
                    <td className="font-semibold">{b.name}</td>
                    <td>{b.in_store_bottles}</td>
                    <td>{b.to_confirm > 0 ? <Badge tone="progress">{b.to_confirm}</Badge> : 0}</td>
                    <td>{b.expiring}</td>
                    <td>{b.to_dispose > 0 ? <Badge tone="urgent">{b.to_dispose}</Badge> : 0}</td>
                    <td>{tc('tables', { count: b.bookings_tonight })}</td>
                    <td>{b.arrived_tonight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel nav:hidden" data-testid="overview-branches-mobile">
            {data.branches.map((b) => (
              <BranchCard key={b.id} b={b} t={t} tc={tc} />
            ))}
          </div>
        </>
      )}

      <h2 className="sec-head">{t('recentDisposals')}</h2>
      {data.recent_disposals.length === 0 ? (
        <EmptyState message={t('noDisposals')} />
      ) : (
        <div className="panel" data-testid="overview-disposals">
          {data.recent_disposals.map((d) => (
            <ListRow
              key={d.id}
              href={`/deposits/${d.id}`}
              title={`${d.item} · ${d.customer} · ${d.branch}`}
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
              aside={<Badge tone="urgent">{ts('deposit.disposed')}</Badge>}
            />
          ))}
        </div>
      )}
    </>
  )
}

function BranchCard({
  b,
  t,
  tc,
}: {
  b: OverviewBranch
  t: Awaited<ReturnType<typeof getTranslations>>
  tc: Awaited<ReturnType<typeof getTranslations>>
}) {
  return (
    <ListRow
      title={b.name}
      meta={
        <span className="tnum">
          {t('colInStore')} {b.in_store_bottles} · {t('colExpiring')} {b.expiring} · {t('colBookingsTonight')} {tc('tables', { count: b.bookings_tonight })} · {t('colArrived')} {b.arrived_tonight}
        </span>
      }
      aside={
        <>
          {b.to_confirm > 0 && <Badge tone="progress">{`${t('colToConfirm')} ${b.to_confirm}`}</Badge>}
          {b.to_dispose > 0 && <Badge tone="urgent">{`${t('colToDispose')} ${b.to_dispose}`}</Badge>}
        </>
      }
    />
  )
}
