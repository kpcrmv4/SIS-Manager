import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Archive, ArrowUpFromLine, CalendarX, ClipboardCheck, MessageCircle, Plus, Wine, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { ListRow } from '@/components/ui/list-row'
import { SearchBox } from '@/components/ui/filter-bar'
import { hrefWith } from '@/components/ui/filter-href'
import { RowLink } from '@/components/deposit/row-link'
import { ExpiredSelectList } from '@/components/deposit/expired-select-list'
import { EmptyTab } from '@/components/deposit/empty-tab'
import { getActorState } from '@/lib/auth/actor'
import { listDeposits, depositTabCounts, parseTab, PAGE_SIZE, DEPOSIT_TABS, type DepositTab } from '@/lib/deposit/list'
import { depositBadgeSpec, badgeText, remainingText } from '@/lib/deposit/format'
import { formatShortDate } from '@/lib/date'

const TAB_LABEL_KEY: Record<DepositTab, string> = {
  inStore: 'tabInStore',
  toConfirm: 'tabToConfirm',
  withdraw: 'tabWithdraw',
  requests: 'tabRequests',
  expired: 'tabExpired',
  closed: 'tabClosed',
}

/**
 * Each filter card's icon and tone (R-046), the same BadgeTone its rows' badges get — six groups,
 * six hues (R-047): in store green, to confirm amber, withdrawals violet, LINE requests blue,
 * expired red, closed grey.
 */
const TAB_LOOK: Record<DepositTab, { icon: LucideIcon; tone: BadgeTone }> = {
  inStore: { icon: Wine, tone: 'done' },
  toConfirm: { icon: ClipboardCheck, tone: 'progress' },
  withdraw: { icon: ArrowUpFromLine, tone: 'violet' },
  requests: { icon: MessageCircle, tone: 'info' },
  expired: { icon: CalendarX, tone: 'urgent' },
  closed: { icon: Archive, tone: 'pending' },
}

const TAB_EMPTY_KEY: Record<DepositTab, string> = {
  inStore: 'emptyInStore',
  toConfirm: 'emptyToConfirm',
  withdraw: 'emptyWithdraw',
  requests: 'emptyRequests',
  expired: 'emptyExpired',
  closed: 'emptyClosed',
}

const TAB_EMPTY_BODY_KEY: Partial<Record<DepositTab, string>> = {
  inStore: 'emptyInStoreBody',
  toConfirm: 'emptyToConfirmBody',
  withdraw: 'emptyWithdrawBody',
  requests: 'emptyRequestsBody',
  expired: 'emptyExpiredBody',
}

export default async function DepositsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const state = await getActorState()
  const t = await getTranslations('deposits')

  const actor = state.status === 'ok' ? state.actor : null
  const branch = actor?.branch ?? null

  if (!actor || !branch) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState message={t('emptyInStore')} />
      </>
    )
  }

  // E2E-only fault injection so the error+retry boundary (error.tsx) has something to
  // prove — never reachable in production and requires a sentinel no real search hits.
  if (process.env.NODE_ENV !== 'production' && sp.q === '__e2e_fail__') {
    throw new Error('E2E fault injection: deposits list')
  }

  const tab = parseTab(sp.tab)
  const q = (sp.q ?? '').trim().slice(0, 200)
  const page = Math.max(1, Number(sp.page) || 1)

  const tRoot = await getTranslations()
  const tc = await getTranslations('common')

  const [counts, { rows, total }] = await Promise.all([depositTabCounts(branch.id), listDeposits(branch.id, tab, q, page)])

  const emptyTitle = q ? t('emptySearch', { q }) : t(TAB_EMPTY_KEY[tab])
  const emptyBody = q || !TAB_EMPTY_BODY_KEY[tab] ? undefined : t(TAB_EMPTY_BODY_KEY[tab]!)
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0
  const to = Math.min(page * PAGE_SIZE, total)

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { branch: branch.name, count: counts.inStore })}
        action={
          <Link href="/deposits/new" className="btn-primary" data-testid="deposits-new">
            <Plus className="size-4" aria-hidden />
            {t('new')}
          </Link>
        }
      />

      <nav aria-label={t('title')} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="deposits-filters">
        {DEPOSIT_TABS.map((key) => {
          const { icon: Icon, tone } = TAB_LOOK[key]
          return (
            <Link
              key={key}
              href={hrefWith('/deposits', sp, { tab: key === 'inStore' ? null : key, page: null })}
              className="fcard"
              aria-current={tab === key ? 'page' : undefined}
              data-tone={tone}
              data-count={counts[key]}
              data-testid={`deposits-tab-${key}`}
            >
              <span className="top">
                <span className="ic" aria-hidden>
                  <Icon className="size-4.5" />
                </span>
                <span className="c">{counts[key]}</span>
              </span>
              <span className="l">{t(TAB_LABEL_KEY[key])}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mb-4">
        <SearchBox basePath="/deposits" params={sp} q={sp.q ?? ''} placeholder={t('searchPlaceholder')} label={tc('search')} />
      </div>

      {tab === 'expired' ? (
        <ExpiredSelectList rows={rows} role={actor.role} locale={actor.locale} emptyTitle={emptyTitle} emptyBody={emptyBody} />
      ) : rows.length === 0 ? (
        <EmptyTab title={emptyTitle} body={emptyBody} />
      ) : (
        <>
          <div className="hidden nav:block panel" data-testid="deposits-table-desktop">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('colCode')}</th>
                  <th>{t('colCustomer')}</th>
                  <th>{t('colItem')}</th>
                  <th>{t('colRemaining')}</th>
                  <th>{t('colExpires')}</th>
                  <th>{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const spec = depositBadgeSpec(r)
                  return (
                    <RowLink key={r.id} href={`/deposits/${r.id}`} testId="deposit-row">
                      <td className="code">{r.code}</td>
                      <td>
                        <b>{r.customerName}</b>
                        {r.customerPhone && <div className="num text-xs text-muted-token">{r.customerPhone}</div>}
                      </td>
                      <td>{r.itemName}</td>
                      <td className="num">
                        <div className="level">
                          <span className="level-bar">
                            <i style={{ width: `${Math.round(r.remainingPercent)}%` }} />
                          </span>
                          {remainingText(tRoot, r.remainingQty, r.remainingPercent)}
                        </div>
                      </td>
                      <td className="num">{r.expiresAt ? formatShortDate(r.expiresAt, actor.locale) : t('noExpiry')}</td>
                      <td>
                        <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
                      </td>
                    </RowLink>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="panel nav:hidden" data-testid="deposits-list-mobile">
            {rows.map((r) => {
              const spec = depositBadgeSpec(r)
              return (
                <ListRow
                  key={r.id}
                  href={`/deposits/${r.id}`}
                  title={r.customerName}
                  meta={
                    <>
                      <span className="code">{r.code}</span> · {r.itemName}
                    </>
                  }
                  aside={
                    // a phone puts this on its own line: badge and amount side by side, flush left
                    <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                      <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
                      <span className="num text-xs text-muted-token">{remainingText(tRoot, r.remainingQty, r.remainingPercent)}</span>
                    </div>
                  }
                />
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between px-1 py-2.5 text-xs text-muted-token nav:px-4" data-testid="deposits-pagination">
            <span className="tnum">{tc('showing', { from, to, total })}</span>
            <span className="flex gap-2">
              <Link
                href={hrefWith('/deposits', sp, { page: page > 1 ? page - 1 : null })}
                aria-disabled={page <= 1}
                className={`btn-ghost btn-sm ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
              >
                {tc('previous')}
              </Link>
              <Link
                href={hrefWith('/deposits', sp, { page: page + 1 })}
                aria-disabled={to >= total}
                className={`btn-ghost btn-sm ${to >= total ? 'pointer-events-none opacity-50' : ''}`}
                data-testid="deposits-next"
              >
                {tc('next')}
              </Link>
            </span>
          </div>
        </>
      )}
    </>
  )
}
