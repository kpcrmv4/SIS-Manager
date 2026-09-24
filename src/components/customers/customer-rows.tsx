import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { ListRow } from '@/components/ui/list-row'
import { hrefWith } from '@/components/ui/filter-href'
import { RowLink } from '@/components/deposit/row-link'
import { CUSTOMER_PAGE, type CustomerList, type CustomerRow } from '@/lib/customers/view'
import { formatShortDate, type AppLocale } from '@/lib/date'
import { VipBadge } from './vip-badge'

type Translate = Awaited<ReturnType<typeof getTranslations>>

/**
 * The customers of one page of /customers (R-048): a table on a computer, rows on a phone, then the
 * pager. Each opens the customer's page.
 */
export async function CustomerRows({
  list,
  page,
  locale,
  params,
}: {
  list: CustomerList
  page: number
  locale: AppLocale
  params: Record<string, string | undefined>
}) {
  const t = await getTranslations('customers')
  const tc = await getTranslations('common')
  const from = list.total ? (page - 1) * CUSTOMER_PAGE + 1 : 0
  const to = Math.min(page * CUSTOMER_PAGE, list.total)

  return (
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
                <td className="num">{bookingsText(t, c, locale)}</td>
                <td className="num">{c.last_at ? formatShortDate(c.last_at, locale) : '—'}</td>
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
                  {c.next_night
                    ? t('nextBooking', { date: formatShortDate(c.next_night, locale) })
                    : c.last_at
                      ? t('lastSeen', { date: formatShortDate(c.last_at, locale) })
                      : ''}
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
            href={hrefWith('/customers', params, { page: page > 1 ? page - 1 : null })}
            aria-disabled={page <= 1}
            className={`btn-ghost btn-sm ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
          >
            {tc('previous')}
          </Link>
          <Link
            href={hrefWith('/customers', params, { page: page + 1 })}
            aria-disabled={to >= list.total}
            className={`btn-ghost btn-sm ${to >= list.total ? 'pointer-events-none opacity-50' : ''}`}
            data-testid="customers-next"
          >
            {tc('next')}
          </Link>
        </span>
      </div>
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
