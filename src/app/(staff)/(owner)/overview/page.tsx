import { getTranslations } from 'next-intl/server'
import { Martini, Users } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { SegmentedFilter } from '@/components/ui/filter-bar'
import { ActionStrip } from '@/components/overview/action-strip'
import { ActivityFeed } from '@/components/overview/activity-feed'
import { BranchOverview } from '@/components/overview/branch-overview'
import { DisposalList } from '@/components/overview/disposal-list'
import { ExpiringList } from '@/components/overview/expiring-list'
import { FiguresPanel, type FlowFigure } from '@/components/overview/figures-panel'
import { OverviewLive } from '@/components/overview/overview-live'
import { TonightPanel } from '@/components/overview/tonight-panel'
import { TopList } from '@/components/overview/top-list'
import { WeekdayChart } from '@/components/overview/weekday-chart'
import { getActorState } from '@/lib/auth/actor'
import { formatLongDate, formatShortDate, formatTime } from '@/lib/date'
import { getDashboard, getTrends } from '@/lib/reports/dashboard'
import { ACTION_KEYS, actionItems, delta, pointsDelta, type Delta } from '@/lib/reports/dashboard-view'
import { SHOP_NAME } from '@/lib/constants'
import { getOverview, parsePeriod, periodRange, previousRange, showRate } from '@/lib/reports/overview'

type Search = Promise<{ period?: string }>

/**
 * Owner landing (P4-01, redesigned R-030): what needs doing → tonight → the business.
 * ต้องจัดการ · five figures with trend · tonight + activity (live) · branches · expiring /
 * disposals · busy weekdays · top customers / liquor. Setup lives on /settings/branch and
 * the exports on /reports (R-034).
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

  // ── figures ── (redesigned 2026-09-27: what each number is made of, no decorative trend lines)
  // a change is shown only against a period that had something — "ใหม่" against zero says nothing
  const change = (cur: number, before: number): Delta => (before > 0 ? delta(cur, before) : null)
  const deltaText = (d: Delta, points = false) =>
    !d ? null : d.pct === null ? t('delta.new') : d.dir === 'same' ? t('delta.same') : points ? t('delta.points', { pts: d.pct }) : t('delta.pct', { pct: d.pct })
  const vsPrev = t('delta.vsPrev', { from: formatShortDate(prev.from, locale), to: formatShortDate(prev.to, locale) })
  const reports = `/reports?from=${from}&to=${to}`
  const rate = showRate(k.arrived, k.no_shows)
  const prevRate = showRate(prev.arrived, prev.no_shows)
  const lastWeekStock = weeks.length >= 2 ? weeks[weeks.length - 2].in_store_end : null
  const stockMove = lastWeekStock ? k.in_store_bottles - lastWeekStock : null
  const rateDelta = prev.arrived + prev.no_shows > 0 ? pointsDelta(rate, prevRate) : null

  // the stock by branch: the brand's own red, fading per branch; past three, the rest together
  const shade = ['var(--brand)', 'color-mix(in srgb, var(--brand) 55%, var(--card))', 'color-mix(in srgb, var(--brand) 28%, var(--card))']
  const byStock = [...branches].sort((x, y) => y.in_store_bottles - x.in_store_bottles)
  const short = (name: string) => name.replace(SHOP_NAME, '').trim() || name
  const stockParts = byStock.slice(0, 3).map((b, i) => ({ key: b.id, label: `${short(b.name)} ${b.in_store_bottles}`, value: b.in_store_bottles, color: shade[i] }))
  const rest = byStock.slice(3).reduce((n, b) => n + b.in_store_bottles, 0)
  if (byStock.length > 3) stockParts.push({ key: 'rest', label: t('otherBranches', { count: rest }), value: rest, color: 'var(--line-strong)' })

  const flowFigures: FlowFigure[] = [
    { key: 'new_deposits', label: t('kpiNew'), value: k.new_deposits, unit: t('depositsUnit'), tone: 'brand', good: 'up', ...fig(k.new_deposits, prev.new_deposits) },
    { key: 'bottles_withdrawn', label: t('kpiWithdrawn'), value: k.bottles_withdrawn, unit: t('bottlesUnit'), tone: 'info', good: 'none', ...fig(k.bottles_withdrawn, prev.bottles_withdrawn) },
    {
      key: 'disposed',
      label: t('kpiDisposed'),
      value: k.disposed,
      tone: 'urgent',
      good: 'down',
      ...fig(k.disposed, prev.disposed),
      // what is still waiting to go says more here than last period's figure
      ...(k.awaiting_disposal > 0 ? { sub: t('awaitingMore', { count: k.awaiting_disposal }), subUrgent: true } : {}),
    },
  ]
  function fig(cur: number, before: number) {
    const d = change(cur, before)
    return { delta: d, deltaText: deltaText(d), deltaTitle: vsPrev, sub: t('prevHint', { value: before }), href: reports }
  }
  const others = Math.max(0, k.bookings - k.arrived - k.no_shows)
  const rateParts = [
    { key: 'arrived', label: t('rateArrived', { count: k.arrived }), value: k.arrived, color: 'var(--status-done)' },
    { key: 'no_show', label: t('rateNoShow', { count: k.no_shows }), value: k.no_shows, color: 'var(--urgent)' },
    { key: 'other', label: t('rateOther', { count: others }), value: others, color: 'var(--line-strong)' },
  ]

  // ── what needs doing ── (setup lives on /settings/branch, exports on /reports — owner, R-034)
  const actions = actionItems(branches, working)
  const expiringTotal = branches.reduce((n, b) => n + b.expiring, 0)
  const actionLabels = Object.fromEntries(ACTION_KEYS.map((key) => [key, t(`action.${key}`)])) as Record<(typeof ACTION_KEYS)[number], string>
  const actionHints = Object.fromEntries(ACTION_KEYS.map((key) => [key, t(`actionHint.${key}`)])) as Record<(typeof ACTION_KEYS)[number], string>
  const jobs = actions.reduce((n, a) => n + a.count, 0)
  const urgentJobs = actions.filter((a) => a.tone === 'urgent').reduce((n, a) => n + a.count, 0)

  return (
    <>
      <OverviewLive branchIds={branches.map((b) => b.id)} working={working} />
      <PageHeader
        title={t('title')}
        subtitle={t('nightLine', { date: formatLongDate(dash.night, locale), time: formatTime(dash.generated_at, locale) })}
        action={
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
        }
      />

      <ActionStrip
        title={t('actionsTitle')}
        none={t('actionsNone')}
        items={actions}
        labels={actionLabels}
        hints={actionHints}
        summary={{ total: t('actionsTotal', { count: jobs }), urgent: urgentJobs ? t('actionsUrgent', { count: urgentJobs }) : null }}
      />

      <FiguresPanel
        stock={{
          label: t('kpiInStore'),
          value: k.in_store_bottles,
          unit: t('bottlesUnit'),
          hint: t('kpiInStoreHint', { branches: k.branches, customers: k.in_store_customers }),
          prev:
            stockMove === null ? null : (
              <span data-testid="kpi-prev-week" data-value={lastWeekStock ?? ''}>
                {t('stockPrevWeek', { count: lastWeekStock ?? 0 })}
                {stockMove !== 0 && (
                  <span className={stockMove > 0 ? 'text-status-done' : 'text-urgent'}> {stockMove > 0 ? `+${stockMove}` : stockMove}</span>
                )}
              </span>
            ),
          branches: stockParts,
          href: '/deposits',
        }}
        flow={{ label: t('flowTitle'), range: `${formatShortDate(from, locale)} – ${formatShortDate(to, locale)}`, figures: flowFigures }}
        rate={{
          label: t('kpiShowRate'),
          value: rate === null ? '—' : `${rate}%`,
          booked: t('rateBooked', { count: k.bookings }),
          delta: rateDelta,
          deltaText: deltaText(rateDelta, true),
          deltaTitle: vsPrev,
          parts: rateParts,
          href: reports,
        }}
      />

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
