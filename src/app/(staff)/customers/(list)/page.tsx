import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ContactRound, Crown, Info, MessageCircle, Wine, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import type { BadgeTone } from '@/components/ui/badge'
import { hrefWith } from '@/components/ui/filter-href'
import { EmptyTab } from '@/components/deposit/empty-tab'
import { BookingBoard } from '@/components/customers/booking-board'
import { CustomerRows } from '@/components/customers/customer-rows'
import { SmartSearch } from '@/components/customers/smart-search'
import { getActorState } from '@/lib/auth/actor'
import { getBookingBoard, listCustomers } from '@/lib/customers/queries'
import { parseBoardFilter, parseSmartQuery, shortcutCodes } from '@/lib/customers/smart'
import { CUSTOMER_FILTERS, parseCustomerFilter, type CustomerFilter } from '@/lib/customers/view'
import { businessNight } from '@/lib/date'

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

/**
 * ลูกค้า (R-048): every customer of the branch — a LINE account, a phone or a name — with what they
 * keep here, their deposits and bookings and when they last came; each opens its own page.
 * The search reads what is typed (R-049): a booking code (BK-0925, BK-0925-001) or the จองวันนี้ /
 * จองพรุ่งนี้ shortcuts bring up that night's bookings as tiles instead of the list.
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
  const tonight = businessNight()
  const smart = parseSmartQuery(q, tonight)
  // a booking code searches bookings, not the customer list
  const textQ = smart.kind === 'text' ? q : ''
  const [list, board] = await Promise.all([
    listCustomers(branch.id, filter, textQ, page),
    smart.kind === 'booking' ? getBookingBoard(branch.id, smart.night, smart.seq) : Promise.resolve(null),
  ])
  const codes = shortcutCodes(tonight)

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle', { branch: branch.name, count: list.counts.all })} />

      <nav aria-label={t('title')} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="customers-filters">
        {CUSTOMER_FILTERS.map((key) => {
          const { icon: Icon, tone, label } = LOOK[key]
          return (
            <Link
              key={key}
              // a card lists customers: it keeps a name or phone search, not a booking code
              href={hrefWith('/customers', sp, { filter: key, page: null, st: null, q: textQ || null })}
              className="fcard"
              aria-current={filter === key && smart.kind === 'text' ? 'page' : undefined}
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
        <SmartSearch
          q={q}
          params={sp}
          placeholder={t('searchPlaceholder')}
          searchLabel={tc('search')}
          clearLabel={t('clearSearch')}
          shortcuts={[
            { key: 'today', label: t('shortcutToday'), code: codes.today },
            { key: 'tomorrow', label: t('shortcutTomorrow'), code: codes.tomorrow },
          ]}
        />
      </div>

      {smart.kind === 'booking' && board ? (
        <BookingBoard board={board} code={smart.code} seq={smart.seq} filter={parseBoardFilter(sp.st)} tonight={tonight} locale={actor.locale} params={sp} />
      ) : smart.kind === 'bookingHint' ? (
        <p className="panel flex items-start gap-2 px-4 py-3 text-sm text-ink-2" data-testid="customers-hint">
          <Info className="mt-0.5 size-4 flex-none text-status-info" aria-hidden />
          {t(smart.reason === 'date' ? 'hintDate' : 'hintBadDate', { example: codes.tomorrow })}
        </p>
      ) : list.rows.length === 0 ? (
        <EmptyTab title={q ? t('emptySearch', { q }) : t(EMPTY[filter])} body={q ? undefined : t(`${EMPTY[filter]}Body`)} />
      ) : (
        <CustomerRows list={list} page={page} locale={actor.locale} params={sp} />
      )}
    </>
  )
}
