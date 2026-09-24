import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Phone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { daysUntil, formatShortDate, formatTime, type AppLocale } from '@/lib/date'
import type { DepositDetail } from '@/lib/deposit/detail'
import { CustomerReminders } from './customer-reminders'

/** The deposit page's cards (R-045): a glanceable summary, then who, then the facts, then the photos. */

type Tone = 'normal' | 'warn' | 'urgent' | 'gold'
const TONE: Record<Tone, string> = { normal: 'text-ink', warn: 'text-status-pending', urgent: 'text-urgent', gold: 'text-gold-ink' }
const CLOSED = new Set(['withdrawn', 'disposed', 'cancelled'])

function Stat({ label, value, unit, sub, tone = 'normal', testId }: { label: string; value: string; unit?: string; sub?: string | null; tone?: Tone; testId?: string }) {
  return (
    <div className="card-surface flex min-w-0 flex-col gap-0.5 px-3 py-2.5" data-testid={testId} data-tone={tone}>
      <span className="text-xs text-muted-token">{label}</span>
      <span className={`truncate text-lg font-bold leading-tight tnum ${TONE[tone]}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-muted-token">{unit}</span>}
      </span>
      {sub && <span className="truncate text-xs text-muted-token tnum">{sub}</span>}
    </div>
  )
}

/** Bottles left · time to expiry (amber inside the branch's expiring-soon window) · table. */
export async function DetailSummary({ detail, noticeDays, locale }: { detail: DepositDetail; noticeDays: number; locale: AppLocale }) {
  const t = await getTranslations('deposit')
  const tRoot = await getTranslations()
  let expiry: { value: string; sub: string | null; tone: Tone }
  if (detail.isVip) expiry = { value: 'VIP', sub: tRoot('deposits.noExpiry'), tone: 'gold' }
  else if (CLOSED.has(detail.status) || !detail.expiresAt) expiry = { value: '—', sub: null, tone: 'normal' }
  else if (detail.status === 'expired') expiry = { value: t('summaryExpired'), sub: formatShortDate(detail.expiresAt, locale), tone: 'urgent' }
  else {
    const days = daysUntil(detail.expiresAt)
    expiry = {
      value: days <= 0 ? t('summaryToday') : t('summaryDaysLeft', { days }),
      sub: formatShortDate(detail.expiresAt, locale),
      tone: days <= noticeDays ? 'warn' : 'normal',
    }
  }
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="deposit-summary">
      <Stat label={t('summaryLeft')} value={`${detail.remainingQty}/${detail.quantity}`} unit={t('summaryBottleUnit')} sub={`${Math.round(detail.remainingPercent)}%`} testId="summary-left" />
      <Stat label={t('expires')} value={expiry.value} sub={expiry.sub} tone={expiry.tone} testId="summary-expiry" />
      <Stat label={t('summaryTable')} value={detail.tableLabel ?? '—'} sub={formatShortDate(detail.createdAt, locale)} testId="summary-table" />
    </div>
  )
}

/** Who: the name, a phone to call from the counter, LINE, and their expiry reminders (R-044). */
export async function CustomerCard({ detail, canEditReminders, branchRemindersOff }: { detail: DepositDetail; canEditReminders: boolean; branchRemindersOff: boolean }) {
  const t = await getTranslations('deposit')
  const tel = detail.customerPhone?.replace(/[^\d+]/g, '') ?? ''
  return (
    <section className="card-surface p-4" data-testid="deposit-customer">
      <h2 className="sec-head">{t('customer')}</h2>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink">{detail.customerName}</div>
          {detail.customerPhone && <div className="num whitespace-nowrap text-sm text-ink-2">{detail.customerPhone}</div>}
        </div>
        {tel && (
          <a href={`tel:${tel}`} className="btn-secondary btn-sm flex-none" data-testid="customer-call">
            <Phone className="size-4" aria-hidden />
            {t('call')}
          </a>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-3 border-t border-line-soft pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-token">{t('line')}</span>
          <Badge tone={detail.customerId ? 'done' : 'pending'}>{detail.customerId ? t('lineLinked') : t('lineNotLinked')}</Badge>
        </div>
        {detail.customerReminders !== null && (
          <CustomerReminders depositId={detail.id} enabled={detail.customerReminders} canEdit={canEditReminders} branchOff={branchRemindersOff} />
        )}
      </div>
    </section>
  )
}

function Fact({ label, children, sub, wide }: { label: string; children: ReactNode; sub?: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <dt className="text-xs text-muted-token">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink tnum">{children}</dd>
      {sub && <dd className="text-xs text-muted-token">{sub}</dd>}
    </div>
  )
}

/** When, how long, and who — label above value, so no value ever breaks in the middle. */
export async function FactsCard({ detail, depositDays, locale }: { detail: DepositDetail; depositDays: number; locale: AppLocale }) {
  const t = await getTranslations('deposit')
  const tRoot = await getTranslations()
  const at = (v: string) => t('collectUntilValue', { date: formatShortDate(v, locale), time: formatTime(v, locale) })
  return (
    <section className="card-surface p-4" data-testid="deposit-facts">
      <h2 className="sec-head">{t('detailsTitle')}</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Fact label={t('depositedAt')}>{at(detail.createdAt)}</Fact>
        <Fact label={t('summaryTable')}>{detail.tableLabel ?? '—'}</Fact>
        <Fact label={t('expires')} sub={detail.isVip || !detail.expiresAt ? undefined : t('depositTerm', { days: depositDays })}>
          {detail.isVip || !detail.expiresAt ? tRoot('deposits.noExpiry') : formatShortDate(detail.expiresAt, locale)}
        </Fact>
        <Fact label={t('collectUntil')}>{detail.collectDeadlineAt ? at(detail.collectDeadlineAt) : '—'}</Fact>
        <Fact label={t('receivedBy')}>{detail.receivedByName ?? '—'}</Fact>
        <Fact label={t('confirmedBy')}>{detail.confirmedByName ?? '—'}</Fact>
        {detail.notes && (
          <Fact label={t('notes')} wide>
            <span className="font-normal">{detail.notes}</span>
          </Fact>
        )}
      </dl>
    </section>
  )
}

/** The photos from receiving and confirming — tap one to see it full size. */
export async function PhotosCard({ urls }: { urls: string[] }) {
  if (!urls.length) return null
  const t = await getTranslations('deposit')
  return (
    <section className="card-surface p-4" data-testid="deposit-photos">
      <h2 className="sec-head">
        {t('photos')}
        <span className="count">{urls.length}</span>
      </h2>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {urls.map((url) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-line bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="size-full object-cover" />
          </a>
        ))}
      </div>
    </section>
  )
}
