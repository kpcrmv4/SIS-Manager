import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ContactRound, Crown, MessageCircle, Wine, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { ListRow } from '@/components/ui/list-row'
import { SearchBox } from '@/components/ui/filter-bar'
import { hrefWith } from '@/components/ui/filter-href'
import { RowLink } from '@/components/deposit/row-link'
import { EmptyTab } from '@/components/deposit/empty-tab'
import { VipBadge } from '@/components/customers/vip-badge'
import { getActorState } from '@/lib/auth/actor'
import { listCustomers } from '@/lib/customers/queries'
import { CUSTOMER_FILTERS, CUSTOMER_PAGE, parseCustomerFilter, type CustomerFilter, type CustomerRow } from '@/lib/customers/view'
import { formatShortDate, type AppLocale } from '@/lib/date'

/** The four summary cards double as the filter (R-048), in the colours their badges use. */
const LOOK: Record<CustomerFilter, { icon: LucideIcon; tone: BadgeTone; label: string }> = {
  all: { icon: ContactRound, tone: 'pending', label: 'filterAll' },
  in_store: { icon: Wine, tone: 'done', label: 'filterInStore' },
  vip: { icon: Crown, tone: 'gold', label: 'filterVip' },
  line: { icon: MessageCircle, tone: 'info', label: 'filterLine' },
}

const EMPTY: Record<CustomerFilter, string> = {
  all: 'emptyAll',
  in_store: 'emptyInStore',
  vip: 'emptyVip',
  line: 'emptyLine',
}

type Translate = Awaited<ReturnType<typeof getTranslations>>

/**
 * ลูกค้า (R-048): every customer of the branch — a LINE account, a phone or a name — with what they
 * keep here, their deposits and bookings and when they last came; each opens its own page.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const state = await getActorState()
  const t = await getTranslations('customers')
  const tc = await getTranslations('common')

  const actor = state.status === 'ok' ? state.actor : null
  const branch = actor?.branch ?? null
  if (!actor || !branch) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyTab title={t('emptyAll')} />
      </>
    )
  }

  // E2E-only fault injection so the error + retry boundary has something to prove (as on /deposits)
  if (process.env.NODE_ENV !== 'production' && sp.q === '__e2e_fail__') {
    throw new Error('E2E fault injection: customers list')
  }

  const filter = parseCustomerFilter(sp.filter)
  const q = (sp.q ?? '').trim().slice(0, 100)
  const page = Math.max(1, Math.trunc(Number(sp.page) || 1))
  const list = await listCustomers(branch.id, filter, q, page)

  const from = list.total ? (page - 1) * CUSTOMER_PAGE + 1 : 0
  const to = Math.min(page * CUSTOMER_PAGE, list.total)

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle', { branch: branch.name, count: list.counts.all })} />

      <nav aria-label={t('title')} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="customers-filters">
        {CUSTOMER_FILTERS.map((key) => {
          const { icon: Icon, tone, label } = LOOK[key]
          return (
            <Link
              key={key}
              href={hrefWith('/customers', sp, { filter: key, page: null })}
              className="fcard"
              aria-current={filter === key ? 'page' : undefined}
              data-tone={tone}
              data-count={list.counts[key]}
              data-testid={`customers-filter-${key}`}
            >
              <span className="top">
                <span className="ic" aria-hidden>
                  <Icon className="size-4.5" />
                </span>
                <span className="c">{list.counts[key]}</span>
              </span>
              <span className="l">{t(label)}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mb-4">
        <SearchBox basePath="/customers" params={sp} q={sp.q ?? ''} placeholder={t('searchPlaceholder')} label={tc('search')} />
      </div>

      {list.rows.length === 0 ? (
        <EmptyTab title={q ? t('emptySearch', { q }) : t(EMPTY[filter])} body={q ? undefined : t(`${EMPTY[filter]}Body`)} />
      ) : (
        <>
          <div className="panel hidden nav:block" data-testid="customers-table-desktop">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('colCustomer')}</th>
                  <th>{t('colLine')}</th>
                  <th>{t('colInStore')}</th>
                  <th>{t('colDeposits')}</th>
                  <th>{t('colBookings')}</th>
                  <th>{t('colLast')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => (
                  <RowLink key={c.key} href={`/customers/${c.key}`} testId="customer-row">
                    <td>
                      <div className="flex items-center gap-2">
                        <b className="min-w-0 truncate">{c.name}</b>
                        {c.is_vip && <VipBadge label={t('vip')} />}
                      </div>
                      {c.phone && <div className="num text-xs text-muted-token">{c.phone}</div>}
                    </td>
                    <td>{c.line ? <Badge tone="info">{t('lineLinked')}</Badge> : <span className="text-muted-token">—</span>}</td>
                    <td className="num">{inStoreText(t, c)}</td>
                    <td className="num">{c.deposits}</td>
                    <td className="num">{bookingsText(t, c, actor.locale)}</td>
                    <td className="num">{c.last_at ? formatShortDate(c.last_at, actor.locale) : '—'}</td>
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel nav:hidden" data-testid="customers-list-mobile">
            {list.rows.map((c) => (
              <ListRow
                key={c.key}
                href={`/customers/${c.key}`}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate">{c.name}</span>
                    {c.is_vip && <VipBadge label={t('vip')} />}
                  </span>
                }
                meta={
                  <span className="num">
                    {[c.phone, c.line ? t('lineLinked') : null, t('rowDeposits', { count: c.deposits }), t('rowBookings', { count: c.bookings })]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                }
                aside={
                  // a phone puts this on its own line: bottles in store and the last visit side by side
                  <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                    {c.deposits_in_store > 0 ? <Badge tone="done">{inStoreText(t, c)}</Badge> : <Badge tone="pending">{t('noBottles')}</Badge>}
                    <span className="num text-xs text-muted-token">
                      {c.next_night ? t('nextBooking', { date: formatShortDate(c.next_night, actor.locale) }) : c.last_at ? t('lastSeen', { date: formatShortDate(c.last_at, actor.locale) }) : ''}
                    </span>
                  </div>
                }
              />
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between px-1 py-2.5 text-xs text-muted-token nav:px-4" data-testid="customers-pagination">
            <span className="tnum">{tc('showing', { from, to, total: list.total })}</span>
            <span className="flex gap-2">
              <Link
                href={hrefWith('/customers', sp, { page: page > 1 ? page - 1 : null })}
                aria-disabled={page <= 1}
                className={`btn-ghost btn-sm ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
              >
                {tc('previous')}
              </Link>
              <Link
                href={hrefWith('/customers', sp, { page: page + 1 })}
                aria-disabled={to >= list.total}
                className={`btn-ghost btn-sm ${to >= list.total ? 'pointer-events-none opacity-50' : ''}`}
                data-testid="customers-next"
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

function inStoreText(t: Translate, c: CustomerRow): string {
  return c.deposits_in_store > 0 ? t('inStoreValue', { bottles: c.bottles_in_store, deposits: c.deposits_in_store }) : '—'
}

function bookingsText(t: Translate, c: CustomerRow, locale: AppLocale): string {
  if (!c.bookings) return '0'
  return c.next_night ? t('bookingsNext', { count: c.bookings, date: formatShortDate(c.next_night, locale) }) : String(c.bookings)
}
