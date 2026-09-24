'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarX, CircleCheck, CircleX, Clock, DoorOpen, type LucideIcon } from 'lucide-react'
import type { CustomerLocale } from '@/lib/i18n/config'
import { daysUntil, formatShortDate } from '@/lib/date'
import { CxEmpty, CxErrorRetry, CxLoader } from './cx-states'
import { customerFetch, useCxSession } from './session-context'

type Status = 'pending' | 'confirmed' | 'arrived' | 'cancelled' | 'rejected' | 'no_show'
type Booking = { id: string; code: string; night: string; slotTime: string; party: number; status: Status; zone: string | null; table: string | null }

/** Each booking says where it stands on its card, so no one has to open it to know (owner). */
const STATUS: Record<Status, { tone: string; Icon: LucideIcon }> = {
  pending: { tone: 'warn', Icon: Clock },
  confirmed: { tone: '', Icon: CircleCheck },
  arrived: { tone: '', Icon: DoorOpen },
  cancelled: { tone: 'danger', Icon: CircleX },
  rejected: { tone: 'danger', Icon: CircleX },
  no_show: { tone: 'muted', Icon: CalendarX },
}

function Row({ b, branchCode, locale }: { b: Booking; branchCode: string; locale: CustomerLocale }) {
  const t = useTranslations('cx')
  const { tone, Icon } = STATUS[b.status] ?? STATUS.pending
  return (
    <Link href={`/liff/${branchCode.toLowerCase()}/ticket/${b.code}`} className="cx-card" data-testid="cx-booking-row" data-code={b.code} data-status={b.status}>
      <div className="flex items-center justify-between gap-2">
        <span className="num text-[15px] font-semibold">{b.code}</span>
        <span className={`cx-pill ${tone}`} data-testid="cx-booking-status">
          <Icon className="size-3.5" aria-hidden />
          {t(`ticket.status.${b.status}`)}
        </span>
      </div>
      <div className="meta num flex justify-between gap-2 text-[12.5px] text-cx-muted">
        <span>
          {formatShortDate(b.night, locale)} · {b.slotTime}
        </span>
        <span className="truncate">
          {b.zone ? t('ticket.partyValue', { count: b.party, zone: b.zone }) : t('ticket.partyNoZone', { count: b.party })}
          {b.table && ` · ${t('ticket.table')} ${b.table}`}
        </span>
      </div>
    </Link>
  )
}

/** "การจองของฉัน" (P2-C3): upcoming (soonest first) + past (most recent first), each links to its ticket. */
export function TicketsListClient() {
  const t = useTranslations('cx')
  // dates follow the language on screen (the session's locale is only the one at sign-in)
  const locale = useLocale() as CustomerLocale
  const session = useCxSession()
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [bookings, setBookings] = useState<Booking[]>([])

  const load = useCallback(() => {
    setState('loading')
    customerFetch(`/api/customer/bookings?branch=${session.branch.code}`, session)
      .then((res) => {
        if (!res.ok) throw new Error('load failed')
        return res.json() as Promise<{ bookings: Booking[] }>
      })
      .then((d) => {
        setBookings(d.bookings)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [session])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  if (state === 'loading') return <CxLoader label={t('ticket.loading')} />
  if (state === 'error') return <CxErrorRetry message={t('shell.errorGeneric')} onRetry={load} />
  if (bookings.length === 0) return <CxEmpty title={t('ticket.listEmpty')} />

  const upcoming = bookings.filter((b) => daysUntil(b.night) >= 0).sort((a, b) => (a.night < b.night ? -1 : 1))
  const past = bookings.filter((b) => daysUntil(b.night) < 0).sort((a, b) => (a.night < b.night ? 1 : -1))

  return (
    <div className="flex flex-col gap-3">
      {upcoming.map((b) => (
        <Row key={b.id} b={b} branchCode={session.branch.code} locale={locale} />
      ))}
      {past.length > 0 && (
        <>
          <p className="cx-label mt-2">{t('bottles.tabHistory')}</p>
          {past.map((b) => (
            <Row key={b.id} b={b} branchCode={session.branch.code} locale={locale} />
          ))}
        </>
      )}
    </div>
  )
}
