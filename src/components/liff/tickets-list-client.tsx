'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import type { CustomerLocale } from '@/lib/i18n/config'
import { daysUntil, formatShortDate } from '@/lib/date'
import { CxEmpty, CxErrorRetry, CxSkeleton } from './cx-states'
import { customerFetch, useCxSession } from './session-context'

type Booking = { id: string; code: string; night: string; slotTime: string; party: number; status: string }

function Row({ b, branchCode, locale }: { b: Booking; branchCode: string; locale: 'th' | 'en' | 'zh' | 'ko' }) {
  const t = useTranslations('cx')
  return (
    <Link href={`/liff/${branchCode.toLowerCase()}/ticket/${b.code}`} className="cx-card" data-testid="cx-booking-row" data-code={b.code} data-status={b.status}>
      <span className="num text-[15px] font-semibold">{b.code}</span>
      <div className="meta num flex justify-between gap-2 text-[12.5px] text-cx-muted">
        <span>
          {formatShortDate(b.night, locale)} · {b.slotTime}
        </span>
        <span>{t('book.partyValue', { count: b.party })}</span>
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

  if (state === 'loading') return <CxSkeleton />
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
