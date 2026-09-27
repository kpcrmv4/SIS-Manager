import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CalendarDays, Martini, Users, Wine } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { DisposalList } from '@/components/overview/disposal-list'
import { ExportMenu } from '@/components/overview/export-menu'
import { TopList } from '@/components/overview/top-list'
import { ReportBranches } from '@/components/reports/report-branches'
import { BookingsChart, FlowChart } from '@/components/reports/report-charts'
import { ReportFigures, type ReportFigure } from '@/components/reports/report-figures'
import { ReportStaffList } from '@/components/reports/report-staff'
import { ReportWeekdays } from '@/components/reports/report-weekdays'
import { getActorState } from '@/lib/auth/actor'
import { addDays, bangkokDate, formatShortDate } from '@/lib/date'
import { getSupabaseServer } from '@/lib/supabase/server'
import { delta, pointsDelta, type Delta } from '@/lib/reports/dashboard-view'
import { getReport, getReportDetail, isYmd, periodRange, previousRange, reportTotals, showRate } from '@/lib/reports/overview'
import type { ReportTotalKey } from '@/lib/reports/period'
import { bucketDays, weekdayTotals } from '@/lib/reports/report-view'
import { FilterDisclosure } from '@/components/ui/filter-disclosure'

type Search = Promise<{ from?: string; to?: string; branch?: string }>

const MAX_SPAN_DAYS = 366

/**
 * P4-01 reports, redesigned (R-034): the period's figures against the previous one, day-by-day
 * (week-by-week past two months) charts, busiest weekdays, top liquor and customers, who did the
 * work, the disposals, and the per-branch table — plus the Excel / PDF exports.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const month = periodRange('month')
  const from = isYmd(sp.from) ? sp.from : month.from
  const to = isYmd(sp.to) ? sp.to : month.to
  const branchId = sp.branch && sp.branch !== 'all' ? sp.branch : null

  const sb = await getSupabaseServer()
  const [t, tc, tOv, tRoles, tb, state, branchesRes] = await Promise.all([
    getTranslations('reports'),
    getTranslations('common'),
    getTranslations('overview'),
    getTranslations('roles'),
    getTranslations('settingsBooking'),
    getActorState(),
    sb.from('branches').select('id, name').order('name').range(0, 199),
  ])
  if (branchesRes.error) throw new Error(`reports branches: ${branchesRes.error.code}`)
  const locale = state.status === 'ok' ? state.actor.locale : 'th'
  const branches = branchesRes.data ?? []
  const fmt = (ymd: string) => formatShortDate(`${ymd}T12:00:00+07:00`, locale)
  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
  const badRange = to < from ? 'badRange' : spanDays > MAX_SPAN_DAYS ? 'rangeTooLong' : null
  const branchName = branchId ? (branches.find((b) => b.id === branchId)?.name ?? t('allBranches')) : t('allBranches')
  const q = new URLSearchParams({ from, to, ...(branchId ? { branch: branchId } : {}) }).toString()

  // quick ranges, keeping the branch filter
  const today = bangkokDate()
  const ranges = [
    { key: 'month', label: t('rangeThisMonth'), ...periodRange('month') },
    { key: 'last', label: t('rangeLastMonth'), ...periodRange('last') },
    { key: '30', label: t('range30'), ...periodRange('30') },
    { key: '90', label: t('range90'), from: addDays(today, -89), to: today },
  ]
  const rangeHref = (r: { from: string; to: string }) => `/reports?${new URLSearchParams({ from: r.from, to: r.to, ...(branchId ? { branch: branchId } : {}) })}`

  const header = (
    <PageHeader
      title={t('title')}
      subtitle={t('rangeBranch', { from: fmt(from), to: fmt(to), branch: branchName })}
      action={
        !badRange && (
          <ExportMenu
            label={t('export')}
            excel={t('exportExcel')}
            pdf={t('exportPdf')}
            excelHref={`/api/reports/export?format=xlsx&${q}`}
            pdfHref={`/api/reports/export?format=pdf&${q}`}
          />
        )
      }
    />
  )

  const filter = (
    <div className="mb-4">
    <FilterDisclosure label={tc('filter')} summary={t('rangeBranch', { from: fmt(from), to: fmt(to), branch: branchName })} testId="reports-filter-fold">
    <form method="get" className="card-surface p-4" data-testid="reports-filter">
      <div role="group" aria-label={t('rangeLabel')} className="tabs mb-3 flex-wrap" data-testid="reports-ranges">
        {ranges.map((r) => {
          const active = r.from === from && r.to === to
          return (
            <Link key={r.key} href={rangeHref(r)} aria-current={active ? 'true' : undefined} data-range={r.key} className="tab">
              {r.label}
            </Link>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div>
          <label className="label-base" htmlFor="r-from">
            {t('from')}
          </label>
          <input id="r-from" name="from" type="date" className="input-base tnum" defaultValue={from} />
        </div>
        <div>
          <label className="label-base" htmlFor="r-to">
            {t('to')}
          </label>
          <input id="r-to" name="to" type="date" className="input-base tnum" defaultValue={to} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label-base" htmlFor="r-branch">
            {t('branch')}
          </label>
          <select id="r-branch" name="branch" className="input-base" defaultValue={branchId ?? 'all'}>
            <option value="all">{t('allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary col-span-2 sm:col-span-1" data-testid="reports-apply">
          {t('apply')}
        </button>
      </div>
    </form>
    </FilterDisclosure>
    </div>
  )

  if (badRange) {
    return (
      <>
        {header}
        {filter}
        <EmptyState message={t(badRange)} />
      </>
    )
  }

  const prev = previousRange(from, to)
  const [report, prevReport, detail] = await Promise.all([getReport(from, to, branchId), getReport(prev.from, prev.to, branchId), getReportDetail(from, to, branchId)])
  const totals = reportTotals(report.branches)
  const before = reportTotals(prevReport.branches)

  const compare = t('vsPrev', { from: fmt(prev.from), to: fmt(prev.to) })
  const dText = (d: Delta, points = false) =>
    !d ? null : d.pct === null ? tOv('delta.new') : d.dir === 'same' ? tOv('delta.same') : points ? tOv('delta.points', { pts: d.pct }) : tOv('delta.pct', { pct: d.pct })
  const fig = (key: ReportTotalKey, label: string, good: ReportFigure['good'], tone?: ReportFigure['tone']): ReportFigure => {
    // a change only against a previous period that had something — "ใหม่" against zero says nothing (as on /overview)
    const d = before[key] > 0 ? delta(totals[key], before[key]) : null
    return { key, label, value: String(totals[key]), delta: d, good, deltaText: dText(d), hint: t('prevHint', { value: before[key] }), tone }
  }
  const rate = showRate(totals.arrived, totals.no_shows)
  const prevRate = showRate(before.arrived, before.no_shows)
  const rateDelta = pointsDelta(rate, prevRate)

  const depositFigures: ReportFigure[] = [
    fig('deposits_new', t('colNewDeposits'), 'up'),
    fig('bottles_new', t('colBottlesNew'), 'up'),
    fig('withdrawals', t('colWithdrawals'), 'none'),
    fig('bottles_withdrawn', t('colBottlesWithdrawn'), 'none'),
    fig('expired', t('colExpired'), 'down'),
    fig('disposed', t('colDisposed'), 'down', 'urgent'),
  ]
  const bookingFigures: ReportFigure[] = [
    fig('bookings', t('colBookings'), 'up'),
    fig('arrived', t('colArrived'), 'up', 'done'),
    fig('no_shows', t('colNoShows'), 'down', 'urgent'),
    fig('cancelled', t('colCancelled'), 'down'),
    {
      key: 'show_rate',
      label: t('colShowRate'),
      value: rate === null ? '—' : `${rate}%`,
      delta: rateDelta,
      good: 'up',
      deltaText: dText(rateDelta, true),
      hint: t('prevHint', { value: prevRate === null ? '—' : `${prevRate}%` }),
      tone: 'done',
    },
  ]

  const { unit, buckets } = bucketDays(detail.days)
  const weekdays = tb.raw('weekdays') as string[]

  return (
    <>
      {header}
      {filter}

      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <ReportFigures title={t('groupDeposits')} icon={Wine} figures={depositFigures} compareTitle={compare} testId="report-figures-deposits" />
        <ReportFigures title={t('groupBookings')} icon={CalendarDays} figures={bookingFigures} compareTitle={compare} testId="report-figures-bookings" />
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <FlowChart buckets={buckets} unit={unit} t={t} locale={locale} />
        <BookingsChart buckets={buckets} unit={unit} t={t} locale={locale} />
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ReportWeekdays days={weekdayTotals(detail.days)} weekdays={weekdays} t={t} className="md:col-span-2 xl:col-span-1" />
        <TopList title={tOv('topItemsTitle')} rows={detail.top_items} t={tOv} icon={Martini} testId="report-top-items" />
        <TopList title={tOv('topCustomersTitle')} rows={detail.top_customers} t={tOv} icon={Users} testId="report-top-customers" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <ReportStaffList staff={detail.staff} t={t} tRoles={tRoles} />
        <DisposalList
          items={detail.disposals}
          t={tOv}
          title={t('disposalsTitle')}
          empty={t('disposalsEmpty')}
          testId="report-disposals"
          disposedLabel={t('colDisposed')}
          locale={locale}
          working={state.status === 'ok' ? (state.actor.branch?.id ?? null) : null}
          showBranch={!branchId && branches.length > 1}
        />
      </div>

      <h2 className="sec-head">{t('byBranch')}</h2>
      {report.branches.length === 0 ? <EmptyState message={t('empty')} /> : <ReportBranches branches={report.branches} t={t} />}
    </>
  )
}
