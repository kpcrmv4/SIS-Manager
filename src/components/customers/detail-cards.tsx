import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { MessageCircle, Phone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ListRow } from '@/components/ui/list-row'
import { hrefWith } from '@/components/ui/filter-href'
import { RowLink } from '@/components/deposit/row-link'
import { badgeText, depositBadgeSpec, remainingText } from '@/lib/deposit/format'
import { bookingBadgeTone } from '@/lib/booking/format'
import { formatShortDate, type AppLocale } from '@/lib/date'
import { HISTORY_PAGE, telHref, type CustomerDetail } from '@/lib/customers/view'

/** The customer page's cards (R-048): what they keep and how often they come, who, then every record. */

function Stat({ label, value, unit, sub, testId }: { label: string; value: string; unit?: string; sub?: string | null; testId: string }) {
  return (
    <div className="card-surface flex min-w-0 flex-col gap-0.5 px-3 py-2.5" data-testid={testId}>
      <span className="text-xs text-muted-token">{label}</span>
      <span className="truncate text-lg font-bold leading-tight text-ink tnum">
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-muted-token">{unit}</span>}
      </span>
      {sub && <span className="truncate text-xs text-muted-token tnum">{sub}</span>}
    </div>
  )
}

/** Bottles in store · deposits (withdrawn) · bookings (arrived / no-show) · last seen (or the next booking). */
export async function CustomerSummary({ detail, locale }: { detail: CustomerDetail; locale: AppLocale }) {
  const t = await getTranslations('customers')
  const s = detail.stats
  const next = s.next_booking
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="customer-summary">
      <Stat
        label={t('statInStore')}
        value={String(s.bottles_in_store)}
        unit={t('unitBottles')}
        sub={t('statInStoreSub', { count: s.deposits_in_store })}
        testId="stat-in-store"
      />
      <Stat
        label={t('statDeposits')}
        value={String(s.deposits)}
        unit={t('unitTimes')}
        sub={t('statDepositsSub', { count: s.bottles_withdrawn })}
        testId="stat-deposits"
      />
      <Stat
        label={t('statBookings')}
        value={String(s.bookings)}
        unit={t('unitTimes')}
        sub={t('statBookingsSub', { arrived: s.arrived, noShow: s.no_show })}
        testId="stat-bookings"
      />
      <Stat
        label={next ? t('statNext') : t('statLast')}
        value={next ? formatShortDate(next.night, locale) : s.last_at ? formatShortDate(s.last_at, locale) : '—'}
        sub={next ? t('statNextSub', { time: next.time }) : s.first_at ? t('statFirstSub', { date: formatShortDate(s.first_at, locale) }) : null}
        testId="stat-last"
      />
    </div>
  )
}

/** Who: the phones to call from the counter, LINE, and the other names they gave. */
export async function ContactCard({ detail }: { detail: CustomerDetail }) {
  const t = await getTranslations('customers')
  const others = detail.names.filter((n) => n !== detail.name)
  return (
    <section className="card-surface p-4" data-testid="customer-contact">
      <h2 className="sec-head">{t('contactTitle')}</h2>
      {detail.phones.length === 0 && <p className="text-sm text-muted-token">{t('noPhone')}</p>}
      <ul className="flex flex-col gap-2">
        {detail.phones.map((p) => (
          <li key={p} className="flex items-center justify-between gap-3">
            <span className="num whitespace-nowrap text-sm text-ink-2">{p}</span>
            <a href={telHref(p)} className="btn-secondary btn-sm flex-none" data-testid="customer-call">
              <Phone className="size-4" aria-hidden />
              {t('call')}
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-col gap-2.5 border-t border-line-soft pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-token">
            <MessageCircle className="size-4" aria-hidden />
            {t('line')}
          </span>
          {detail.line ? (
            <Badge tone="info">{detail.line.name ? t('lineAs', { name: detail.line.name }) : t('lineLinked')}</Badge>
          ) : (
            <Badge tone="pending">{t('lineNotLinked')}</Badge>
          )}
        </div>
        {detail.line && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-token">{t('reminders')}</span>
            <span className="text-sm text-ink-2">{detail.line.reminders ? t('remindersOn') : t('remindersOff')}</span>
          </div>
        )}
        {others.length > 0 && (
          <div className="min-w-0">
            <div className="text-sm text-muted-token">{t('otherNames')}</div>
            <div className="mt-0.5 wrap-break-word text-sm text-ink-2" data-testid="customer-other-names">
              {others.join(' · ')}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Pager({ base, sp, param, page, total, testId }: { base: string; sp: Record<string, string | undefined>; param: string; page: number; total: number; testId: string }) {
  if (total <= HISTORY_PAGE) return null
  const last = Math.max(1, Math.ceil(total / HISTORY_PAGE))
  return (
    <div className="flex items-center justify-end gap-2 px-1 pt-2" data-testid={testId}>
      <Link
        href={hrefWith(base, sp, { [param]: page > 2 ? page - 1 : null })}
        aria-disabled={page <= 1}
        className={`btn-ghost btn-sm ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
      >
        ‹
      </Link>
      <span className="text-xs text-muted-token tnum">
        {page} / {last}
      </span>
      <Link
        href={hrefWith(base, sp, { [param]: page + 1 })}
        aria-disabled={page >= last}
        className={`btn-ghost btn-sm ${page >= last ? 'pointer-events-none opacity-50' : ''}`}
        data-testid={`${testId}-next`}
      >
        ›
      </Link>
    </div>
  )
}

/** Every deposit, newest first — a table on a computer, rows on a phone; each opens its deposit. */
export async function DepositHistory({
  detail,
  locale,
  base,
  sp,
  page,
}: {
  detail: CustomerDetail
  locale: AppLocale
  base: string
  sp: Record<string, string | undefined>
  page: number
}) {
  const t = await getTranslations('customers')
  const tRoot = await getTranslations()
  const rows = detail.deposits.rows
  return (
    <section data-testid="customer-deposits">
      <h2 className="sec-head">
        {t('depositsTitle')}
        <span className="count">{detail.deposits.total}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="panel px-4 py-6 text-center text-sm text-muted-token">{t('noDeposits')}</p>
      ) : (
        <>
          <div className="panel hidden nav:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('colCode')}</th>
                  <th>{t('colItem')}</th>
                  <th>{t('colRemaining')}</th>
                  <th>{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const spec = depositBadgeSpec({ status: d.status, isVip: d.is_vip, expiresAt: d.expires_at })
                  return (
                    // the column beside the VIP card is narrow: codes, figures and badges never break
                    <RowLink key={d.id} href={`/deposits/${d.id}`} testId="customer-deposit-row">
                      <td className="whitespace-nowrap">
                        <span className="code">{d.code}</span>
                        <div className="num text-xs text-muted-token">{formatShortDate(d.created_at, locale)}</div>
                      </td>
                      <td>{d.item}</td>
                      <td className="num whitespace-nowrap">{remainingText(tRoot, d.remaining_qty, Number(d.remaining_percent))}</td>
                      <td className="whitespace-nowrap">
                        <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
                      </td>
                    </RowLink>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="panel nav:hidden">
            {rows.map((d) => {
              const spec = depositBadgeSpec({ status: d.status, isVip: d.is_vip, expiresAt: d.expires_at })
              return (
                <ListRow
                  key={d.id}
                  href={`/deposits/${d.id}`}
                  title={d.item}
                  meta={
                    <>
                      <span className="code">{d.code}</span> · <span className="num">{formatShortDate(d.created_at, locale)}</span>
                    </>
                  }
                  aside={
                    <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                      <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
                      <span className="num text-xs text-muted-token">{remainingText(tRoot, d.remaining_qty, Number(d.remaining_percent))}</span>
                    </div>
                  }
                />
              )
            })}
          </div>
          <Pager base={base} sp={sp} param="dp" page={page} total={detail.deposits.total} testId="customer-deposits-pager" />
        </>
      )}
    </section>
  )
}

/** Every booking, latest night first; each opens that night's list on /bookings. */
export async function BookingHistory({
  detail,
  locale,
  base,
  sp,
  page,
}: {
  detail: CustomerDetail
  locale: AppLocale
  base: string
  sp: Record<string, string | undefined>
  page: number
}) {
  const t = await getTranslations('customers')
  const ts = await getTranslations('status')
  const rows = detail.bookings.rows
  const where = (b: CustomerDetail['bookings']['rows'][number]) => [b.zone, b.table ? t('tableValue', { table: b.table }) : null].filter(Boolean).join(' · ') || '—'
  const href = (b: CustomerDetail['bookings']['rows'][number]) => `/bookings?night=${b.night}&view=list`
  return (
    <section data-testid="customer-bookings">
      <h2 className="sec-head">
        {t('bookingsTitle')}
        <span className="count">{detail.bookings.total}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="panel px-4 py-6 text-center text-sm text-muted-token">{t('noBookings')}</p>
      ) : (
        <>
          <div className="panel hidden nav:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('colBookingCode')}</th>
                  <th>{t('colNight')}</th>
                  <th>{t('colParty')}</th>
                  <th>{t('colWhere')}</th>
                  <th>{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <RowLink key={b.id} href={href(b)} testId="customer-booking-row">
                    <td className="code whitespace-nowrap">{b.code}</td>
                    <td className="num whitespace-nowrap">{t('nightValue', { date: formatShortDate(b.night, locale), time: b.time })}</td>
                    <td className="num whitespace-nowrap">{t('partyValue', { count: b.party })}</td>
                    <td>{where(b)}</td>
                    <td className="whitespace-nowrap">
                      <Badge tone={bookingBadgeTone(b.status)}>{ts(`booking.${b.status}`)}</Badge>
                    </td>
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel nav:hidden">
            {rows.map((b) => (
              <ListRow
                key={b.id}
                href={href(b)}
                title={<span className="num">{t('nightValue', { date: formatShortDate(b.night, locale), time: b.time })}</span>}
                meta={
                  <>
                    <span className="code">{b.code}</span> · {t('partyValue', { count: b.party })} · {where(b)}
                  </>
                }
                aside={<Badge tone={bookingBadgeTone(b.status)}>{ts(`booking.${b.status}`)}</Badge>}
              />
            ))}
          </div>
          <Pager base={base} sp={sp} param="bp" page={page} total={detail.bookings.total} testId="customer-bookings-pager" />
        </>
      )}
    </section>
  )
}
