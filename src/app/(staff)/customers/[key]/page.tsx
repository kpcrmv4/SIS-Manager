import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CalendarDays, MessageCircle, Phone } from 'lucide-react'
import { BackLink } from '@/components/shell/back-link'
import { VipBadge } from '@/components/customers/vip-badge'
import { VipCard } from '@/components/customers/vip-card'
import { BookingHistory, ContactCard, CustomerSummary, DepositHistory } from '@/components/customers/detail-cards'
import { getActorState, isBarOrOwner } from '@/lib/auth/actor'
import { getCustomer } from '@/lib/customers/queries'
import { CUSTOMER_LOOKUP } from '@/lib/customers/view'
import { getBranchSettings } from '@/lib/deposit/branch'
import { formatShortDate } from '@/lib/date'

type Search = Promise<Record<string, string | undefined>>

/**
 * One customer (R-048): what they keep here and how often they come, VIP, how to reach them,
 * then every deposit and every booking. Opened from a deposit or a booking ('d-' / 'b-') or by a
 * phone ('p-'), it lands on the customer's own key.
 */
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Search }) {
  const { key: raw } = await params
  const key = decodeURIComponent(raw).trim().toLowerCase()
  if (!CUSTOMER_LOOKUP.test(key)) notFound()

  const state = await getActorState()
  if (state.status !== 'ok' || !state.actor.branch) notFound()
  const { actor } = state
  const branch = actor.branch!

  const sp = await searchParams
  const depositPage = Math.max(1, Math.trunc(Number(sp.dp) || 1))
  const bookingPage = Math.max(1, Math.trunc(Number(sp.bp) || 1))

  const [detail, settings] = await Promise.all([getCustomer(branch.id, key, depositPage, bookingPage), getBranchSettings(branch.id)])
  if (!detail) notFound()
  if (detail.key !== key) redirect(`/customers/${detail.key}`)

  const t = await getTranslations('customers')
  const base = `/customers/${detail.key}`
  const history = { dp: sp.dp, bp: sp.bp }

  return (
    <>
      <BackLink fallbackHref="/customers" fallbackLabel={t('back')} />
      <header className="mb-4" data-testid="customer-header" data-key={detail.key}>
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 wrap-break-word text-2xl font-bold leading-tight text-ink">{detail.name}</h1>
          {detail.vip && <VipBadge label={t('vip')} />}
        </div>
        {/* icons, not "·" separators: a wrapped line never starts or ends on a dot */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm text-muted-token">
          {detail.phones[0] && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap num">
              <Phone className="size-3.5" aria-hidden />
              {detail.phones[0]}
            </span>
          )}
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <MessageCircle className="size-3.5" aria-hidden />
            {detail.line ? t('lineLinked') : t('lineNotLinked')}
          </span>
          {detail.stats.first_at && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap num">
              <CalendarDays className="size-3.5" aria-hidden />
              {t('since', { date: formatShortDate(detail.stats.first_at, actor.locale) })}
            </span>
          )}
        </div>
      </header>

      <CustomerSummary detail={detail} locale={actor.locale} />

      {/* grid-cols-1 = minmax(0,1fr): long rows truncate instead of widening a phone (R-047) */}
      <div className="grid grid-cols-1 items-start gap-4 nav:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <aside className="flex min-w-0 flex-col gap-4 nav:order-2">
          <VipCard
            branchId={branch.id}
            customerKey={detail.key}
            isVip={Boolean(detail.vip)}
            since={detail.vip ? formatShortDate(detail.vip.since, actor.locale) : null}
            by={detail.vip?.by ?? null}
            canVip={detail.can_vip}
            canEdit={isBarOrOwner(actor.role)}
            toVip={detail.stats.to_vip}
            vipDeposits={detail.stats.vip_deposits}
            depositDays={settings?.depositDays ?? 30}
          />
          <ContactCard detail={detail} />
        </aside>
        <div className="flex min-w-0 flex-col gap-4 nav:order-1">
          <DepositHistory detail={detail} locale={actor.locale} base={base} sp={history} page={depositPage} />
          <BookingHistory detail={detail} locale={actor.locale} base={base} sp={history} page={bookingPage} />
        </div>
      </div>
    </>
  )
}
