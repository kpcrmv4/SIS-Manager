import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ArrowUpFromLine, ClipboardList, Trash2, Wine } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { Metric, MetricBar } from '@/components/ui/metric'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { HistoryList, type HistoryText } from '@/components/deposit/history-list'
import { getActorState } from '@/lib/auth/actor'
import { eventText } from '@/lib/deposit/format'
import { HISTORY_GROUPS, HISTORY_PAGE, getDepositHistory, isHistoryGroup, type HistoryFeed } from '@/lib/deposit/history'
import { addDays, businessNight, formatShortDate } from '@/lib/date'

type Search = Promise<{ from?: string; to?: string; g?: string; actor?: string; q?: string; page?: string }>

const YMD = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SPAN_DAYS = 366

/**
 * ประวัติฝาก/เบิก (R-061): every deposit and withdrawal event of the working branch, for every role —
 * by business night (tonight by default), kind, who, and a search; the period's totals on top.
 */
export default async function DepositHistoryPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const [t, tRoot, state] = await Promise.all([getTranslations('depositHistory'), getTranslations(), getActorState()])
  const actor = state.status === 'ok' ? state.actor : null
  const branch = actor?.branch ?? null
  if (!actor || !branch) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState icon={ClipboardList} message={t('empty')} />
      </>
    )
  }
  const locale = actor.locale

  const tonight = businessNight()
  const from = sp.from && YMD.test(sp.from) ? sp.from : tonight
  const to = sp.to && YMD.test(sp.to) ? sp.to : from > tonight ? from : tonight
  const group = isHistoryGroup(sp.g) ? sp.g : null
  const who = sp.actor === 'customer' || sp.actor === 'system' || (sp.actor && UUID.test(sp.actor)) ? sp.actor : null
  const q = (sp.q ?? '').trim().slice(0, 60)
  const page = Math.max(1, Math.trunc(Number(sp.page) || 1))
  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
  const badRange = to < from ? 'badRange' : spanDays > MAX_SPAN_DAYS ? 'rangeTooLong' : null

  const fmt = (ymd: string) => formatShortDate(`${ymd}T12:00:00+07:00`, locale)
  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams()
    const cur: Record<string, string | null> = { from, to, g: group, actor: who, q: q || null, ...patch }
    for (const [k, v] of Object.entries(cur)) if (v) params.set(k, v)
    return `/deposits/history?${params}`
  }

  const header = (
    <PageHeader
      title={t('title')}
      subtitle={from === to ? t('subtitleOne', { branch: branch.name, from: fmt(from) }) : t('subtitle', { branch: branch.name, from: fmt(from), to: fmt(to) })}
    />
  )
  const feed: HistoryFeed | null = badRange ? null : await getDepositHistory({ branchId: branch.id, from, to, group, actor: who, q, page })
  const counts = feed?.counts
  const all = counts ? HISTORY_GROUPS.reduce((n, g) => n + (counts[g] ?? 0), 0) : 0
  const ranges = [
    { key: 'tonight', label: t('tonight'), from: tonight, to: tonight },
    { key: 'yesterday', label: t('yesterday'), from: addDays(tonight, -1), to: addDays(tonight, -1) },
    { key: '7', label: t('last7'), from: addDays(tonight, -6), to: tonight },
  ]

  const filters = (
    <div className="mb-5 flex flex-col gap-3">
      {feed && (
        <MetricBar>
          <Metric label={t('sumReceived')} value={feed.summary.received} unit={t('unitDeposits')} icon={Wine} tone="progress" />
          <Metric label={t('sumWithdrawn')} value={feed.summary.withdrawn} unit={t('unitBottles')} icon={ArrowUpFromLine} tone="violet" />
          <Metric label={t('sumDisposed')} value={feed.summary.disposed} unit={t('unitDeposits')} icon={Trash2} tone="urgent" />
        </MetricBar>
      )}
      <div role="group" aria-label={t('groupsLabel')} className="tabs flex-wrap" data-testid="history-groups">
        {[null, ...HISTORY_GROUPS].map((g) => (
          <Link
            key={g ?? 'all'}
            href={href({ g, page: null })}
            aria-current={group === g ? 'true' : undefined}
            className="tab"
            data-group={g ?? 'all'}
            data-count={g ? (counts?.[g] ?? 0) : all}
          >
            {t(`groups.${g ?? 'all'}`)}
            <span className="c">{g ? (counts?.[g] ?? 0) : all}</span>
          </Link>
        ))}
      </div>
      <form method="get" action="/deposits/history" className="card-surface p-4" data-testid="history-filter">
        <div role="group" aria-label={t('rangeLabel')} className="tabs mb-3 flex-wrap" data-testid="history-ranges">
          {ranges.map((r) => (
            <Link key={r.key} href={href({ from: r.from, to: r.to, page: null })} aria-current={r.from === from && r.to === to ? 'true' : undefined} className="tab" data-range={r.key}>
              {r.label}
            </Link>
          ))}
        </div>
        {group && <input type="hidden" name="g" value={group} />}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1fr_1.4fr_auto] md:items-end">
          <div>
            <label className="label-base" htmlFor="h-from">
              {t('from')}
            </label>
            <input id="h-from" name="from" type="date" className="input-base tnum" defaultValue={from} />
          </div>
          <div>
            <label className="label-base" htmlFor="h-to">
              {t('to')}
            </label>
            <input id="h-to" name="to" type="date" className="input-base tnum" defaultValue={to} />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="label-base" htmlFor="h-actor">
              {t('actor')}
            </label>
            <select id="h-actor" name="actor" className="input-base" defaultValue={who ?? ''} data-testid="history-actor">
              <option value="">{t('anyone')}</option>
              {(feed?.actors ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? t('unknownActor')}
                </option>
              ))}
              <option value="customer">{t('customer')}</option>
              <option value="system">{t('system')}</option>
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="label-base" htmlFor="h-q">
              {t('search')}
            </label>
            <input id="h-q" name="q" type="search" className="input-base" defaultValue={q} placeholder={t('searchPlaceholder')} maxLength={60} data-testid="history-q" />
          </div>
          <button type="submit" className="btn-primary col-span-2 md:col-span-1" data-testid="history-apply">
            {t('apply')}
          </button>
        </div>
      </form>
    </div>
  )

  if (badRange) {
    return (
      <>
        {header}
        {filters}
        <EmptyState message={t(badRange)} />
      </>
    )
  }
  if (!feed) {
    return (
      <>
        {header}
        {filters}
        <RefreshRetry />
      </>
    )
  }

  const text: HistoryText = {
    what: (r) => eventText(tRoot, { action: r.action, payload: r.payload }, locale),
    who: (r) => (r.actor_kind === 'customer' ? t('customer') : r.actor_kind === 'system' ? t('system') : (r.actor_name ?? t('unknownActor'))),
    role: (r) => (r.actor_kind === 'staff' && r.actor_role ? tRoot(`roles.${r.actor_role}`) : null),
  }
  const first = feed.total ? (page - 1) * HISTORY_PAGE + 1 : 0
  const last = Math.min(page * HISTORY_PAGE, feed.total)

  return (
    <>
      {header}
      {filters}
      {feed.rows.length === 0 ? (
        <EmptyState icon={ClipboardList} message={t('empty')} />
      ) : (
        <>
          <HistoryList rows={feed.rows} text={text} locale={locale} cols={{ time: t('colTime'), what: t('colWhat'), deposit: t('colDeposit'), who: t('colWho') }} />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-token">
            <span className="tnum" data-testid="history-showing">
              {t('showing', { from: first, to: last, total: feed.total })}
            </span>
            <span className="flex gap-2">
              {page > 1 && (
                <Link href={href({ page: String(page - 1) })} className="btn-ghost btn-sm">
                  {t('prev')}
                </Link>
              )}
              {last < feed.total && (
                <Link href={href({ page: String(page + 1) })} className="btn-ghost btn-sm" data-testid="history-next">
                  {t('next')}
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </>
  )
}
