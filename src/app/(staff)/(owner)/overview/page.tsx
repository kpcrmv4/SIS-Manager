import { getTranslations } from 'next-intl/server'
import { GlassWater, Martini, PackagePlus, Trash2, UserCheck, Users, Wine } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { SegmentedFilter } from '@/components/ui/filter-bar'
import { ActionStrip } from '@/components/overview/action-strip'
import { ActivityFeed } from '@/components/overview/activity-feed'
import { BranchOverview } from '@/components/overview/branch-overview'
import { DisposalList } from '@/components/overview/disposal-list'
import { ExpiringList } from '@/components/overview/expiring-list'
import { ExportMenu } from '@/components/overview/export-menu'
import { KpiStrip, type KpiCell } from '@/components/overview/kpi-strip'
import { OverviewLive } from '@/components/overview/overview-live'
import { SetupChecklist } from '@/components/overview/setup-checklist'
import { TonightPanel } from '@/components/overview/tonight-panel'
import { TopList } from '@/components/overview/top-list'
import { WeekdayChart } from '@/components/overview/weekday-chart'
import { getActorState } from '@/lib/auth/actor'
import { formatLongDate, formatShortDate, formatTime } from '@/lib/date'
import { getDashboard, getTrends } from '@/lib/reports/dashboard'
import { ACTION_KEYS, SETUP_KEYS, actionItems, delta, pointsDelta, setupItems, weeklyShowRate, type Delta, type TrendWeek } from '@/lib/reports/dashboard-view'
import { getOverview, parsePeriod, periodRange, previousRange, showRate } from '@/lib/reports/overview'

type Search = Promise<{ period?: string }>

/**
 * Owner landing (P4-01, redesigned R-030): what needs doing → tonight → the business.
 * Setup checklist (until done) · ต้องจัดการ · five figures with trend · tonight + activity (live) ·
 * branches · expiring / disposals · busy weekdays · top customers / liquor.
 */
export default async function OverviewPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const { from, to } = periodRange(period)
  const prevRange = previousRange(from, to)
  const [t, tRoot, tc, ts, tb, state, data, dash, trends] = await Promise.all([
    getTranslations('overview'),
    getTranslations(),
    getTranslations('common'),
    getTranslations('status'),
    getTranslations('settingsBooking'),
    getActorState(),
    getOverview(from, to),
    getDashboard(),
    getTrends(from, to, prevRange),
  ])
  const actor = state.status === 'ok' ? state.actor : null
  const locale = actor?.locale ?? 'th'
  const working = actor?.branch?.id ?? null
  const branches = dash.branches
  const multi = branches.length > 1
  const weekdays = tb.raw('weekdays') as string[]
  const k = data.kpi
  const prev = trends.prev
  const weeks = trends.weeks

  // ── figures ──
  const deltaText = (d: Delta, points = false) =>
    !d ? null : d.pct === null ? t('delta.new') : d.dir === 'same' ? t('delta.same') : points ? t('delta.points', { pts: d.pct }) : t('delta.pct', { pct: d.pct })
  const vsPrev = t('delta.vsPrev', { from: formatShortDate(prev.from, locale), to: formatShortDate(prev.to, locale) })
  const spark = (values: (number | null)[]) => t('spark', { values: values.map((v) => v ?? '–').join(', ') })
  const series = (key: keyof Omit<TrendWeek, 'start'>) => weeks.map((w) => w[key])
  const reports = `/reports?from=${from}&to=${to}`
  const rate = showRate(k.arrived, k.no_shows)
  const prevRate = showRate(prev.arrived, prev.no_shows)
  const lastWeekStock = weeks.length >= 2 ? weeks[weeks.length - 2].in_store_end : null
  const stockDelta = lastWeekStock === null ? null : delta(k.in_store_bottles, lastWeekStock)
  const newDelta = delta(k.new_deposits, prev.new_deposits)
  const outDelta = delta(k.bottles_withdrawn, prev.bottles_withdrawn)
  const disposedDelta = delta(k.disposed, prev.disposed)
  const rateDelta = pointsDelta(rate, prevRate)
  const rates = weeklyShowRate(weeks)

  const cells: KpiCell[] = [
    {
      key: 'in_store',
      label: t('kpiInStore'),
      icon: Wine,
      value: String(k.in_store_bottles),
      unit: t('bottlesUnit'),
      hint: t('kpiInStoreHint', { branches: k.branches, customers: k.in_store_customers }),
      tone: 'default',
      delta: stockDelta,
      good: 'none',
      deltaText: deltaText(stockDelta),
      deltaTitle: t('delta.vsLastWeek'),
      series: series('in_store_end'),
      seriesLabel: spark(series('in_store_end')),
      href: '/deposits',
    },
    {
      key: 'new_deposits',
      label: t('kpiNew'),
      icon: PackagePlus,
      value: String(k.new_deposits),
      hint: t('prevHint', { value: prev.new_deposits }),
      tone: 'default',
      delta: newDelta,
      good: 'up',
      deltaText: deltaText(newDelta),
      deltaTitle: vsPrev,
      series: series('new_deposits'),
      seriesLabel: spark(series('new_deposits')),
      href: reports,
    },
    {
      key: 'bottles_withdrawn',
      label: t('kpiWithdrawn'),
      icon: GlassWater,
      value: String(k.bottles_withdrawn),
      unit: t('bottlesUnit'),
      hint: t('prevHint', { value: prev.bottles_withdrawn }),
      tone: 'info',
      delta: outDelta,
      good: 'none',
      deltaText: deltaText(outDelta),
      deltaTitle: vsPrev,
      series: series('bottles_withdrawn'),
      seriesLabel: spark(series('bottles_withdrawn')),
      href: reports,
    },
    {
      key: 'disposed',
      label: t('kpiDisposed'),
      icon: Trash2,
      value: String(k.disposed),
      hint: t('kpiDisposedHint', { count: k.awaiting_disposal }),
      tone: 'urgent',
      delta: disposedDelta,
      good: 'down',
      deltaText: deltaText(disposedDelta),
      deltaTitle: vsPrev,
      series: series('disposed'),
      seriesLabel: spark(series('disposed')),
      href: reports,
    },
    {
      key: 'show_rate',
      label: t('kpiShowRate'),
      icon: UserCheck,
      value: rate === null ? '—' : `${rate}%`,
      hint: t('kpiShowRateHint', { bookings: k.bookings, noShows: k.no_shows }),
      tone: 'done',
      delta: rateDelta,
      good: 'up',
      deltaText: deltaText(rateDelta, true),
      deltaTitle: vsPrev,
      series: rates,
      seriesLabel: spark(rates),
      seriesMax: 100,
      href: reports,
    },
  ]

  // ── what needs doing ──
  const actions = actionItems(branches, working)
  const setup = setupItems(branches, working)
  const setupOpen = setup.some((s) => !s.done)
  const expiringTotal = branches.reduce((n, b) => n + b.expiring, 0)
  const actionLabels = Object.fromEntries(ACTION_KEYS.map((key) => [key, t(`action.${key}`)])) as Record<(typeof ACTION_KEYS)[number], string>
  const setupLabels = Object.fromEntries(SETUP_KEYS.map((key) => [key, t(`setup.${key}`)])) as Record<(typeof SETUP_KEYS)[number], string>
  const setupHints = Object.fromEntries(SETUP_KEYS.map((key) => [key, t(`setupHint.${key}`)])) as Record<(typeof SETUP_KEYS)[number], string>

  return (
    <>
      <OverviewLive branchIds={branches.map((b) => b.id)} working={working} />
      <PageHeader
        title={t('title')}
        subtitle={t('nightLine', { date: formatLongDate(dash.night, locale), time: formatTime(dash.generated_at, locale) })}
        action={
          <>
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
            <ExportMenu
              label={t('export')}
              excel={t('exportExcel')}
              pdf={t('exportPdf')}
              excelHref={`/api/reports/export?format=xlsx&from=${from}&to=${to}`}
              pdfHref={`/api/reports/export?format=pdf&from=${from}&to=${to}`}
            />
          </>
        }
      />

      {setupOpen && (
        <SetupChecklist
          title={t('setupTitle')}
          progress={t('setupProgress', { done: setup.filter((s) => s.done).length, total: setup.length })}
          go={t('setupGo')}
          items={setup}
          labels={setupLabels}
          hints={setupHints}
          missing={(names) => (multi && names.length ? t('setupMissing', { branches: names.join(', ') }) : null)}
        />
      )}

      <ActionStrip title={t('actionsTitle')} none={t('actionsNone')} items={actions} labels={actionLabels} />

      <KpiStrip cells={cells} />

      {/* left: tonight and the bottles at risk · right: what just happened — two columns of similar height */}
      <div className="grid items-start gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          <TonightPanel tonight={dash.tonight} t={t} nightLabel={formatShortDate(dash.night, locale)} planHref="/bookings" />
          <ExpiringList items={dash.expiring} total={expiringTotal} t={t} locale={locale} working={working} showBranch={multi} now={new Date(dash.generated_at)} />
          <DisposalList items={data.recent_disposals} t={t} disposedLabel={ts('deposit.disposed')} locale={locale} working={working} showBranch={multi} />
        </div>
        <ActivityFeed className="min-w-0 xl:col-span-5" items={dash.activity} t={t} tRoot={tRoot} locale={locale} working={working} showBranch={multi} />
      </div>

      <h2 className="sec-head">{t('byBranch')}</h2>
      {branches.length === 0 ? (
        <EmptyState message={t('noBranches')} />
      ) : (
        <BranchOverview branches={branches} t={t} tc={tc} weekdays={weekdays} locale={locale} working={working} />
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <WeekdayChart days={trends.weekdays} weekdays={weekdays} t={t} className="md:col-span-2 xl:col-span-1" />
        <TopList title={t('topCustomersTitle')} rows={trends.top_customers} t={t} icon={Users} testId="overview-top-customers" />
        <TopList title={t('topItemsTitle')} rows={trends.top_items} t={t} icon={Martini} testId="overview-top-items" />
      </div>
    </>
  )
}
