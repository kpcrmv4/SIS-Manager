'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ListRow } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/states'
import { Badge } from '@/components/ui/badge'
import type { NightBooking } from '@/lib/booking/queries'
import { minutesLate, bookingBadgeTone, LIVE_STATUSES } from '@/lib/booking/format'
import { formatTime } from '@/lib/date'
import type { AppLocale } from '@/lib/date'

export function BookingList({
  bookings,
  night,
  locale,
  isBarOrOwner,
  onSelectBooking,
  onConfirm,
  onReject,
}: {
  bookings: NightBooking[]
  night: string
  locale: AppLocale
  isBarOrOwner: boolean
  onSelectBooking?: (bookingId: string) => void
  onConfirm?: (bookingId: string) => void
  onReject?: (bookingId: string) => void
}) {
  const t = useTranslations('bookings')
  const ts = useTranslations('status')
  const tc = useTranslations('common')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!bookings.length) {
    return <EmptyState message={t('empty')} />
  }

  return (
    <div className="panel">
      {bookings.map((b) => {
        const live = LIVE_STATUSES.includes(b.status)
        const late = live && b.status !== 'arrived' ? minutesLate(night, b.slotTime, now) : 0
        const sourceText = b.source === 'line' ? t('sourceLineAt', { time: formatTime(b.createdAt, locale) }) : t('sourceStaff')
        const meta = (
          <span className="tnum">
            {b.slotTime.slice(0, 5)} · {b.tableLabel ?? t('unassigned')} · <span className="code">{b.code}</span> · {sourceText}
            {late > 0 && <> · {ts('lateBy', { count: late })}</>}
          </span>
        )
        const title = `${b.name} · ${tc('people', { count: b.party })}`

        const aside =
          b.status === 'pending' && isBarOrOwner ? (
            <span className="flex gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onReject?.(b.id)
                }}
              >
                {tc('reject')}
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onConfirm?.(b.id)
                }}
              >
                {t('confirmAssign')}
              </button>
            </span>
          ) : (
            <Badge tone={late > 0 ? 'progress' : bookingBadgeTone(b.status)}>
              {late > 0 ? ts('lateBy', { count: late }) : ts(`booking.${b.status}`)}
            </Badge>
          )

        return (
          <div
            key={b.id}
            role={onSelectBooking ? 'button' : undefined}
            tabIndex={onSelectBooking ? 0 : undefined}
            className={onSelectBooking ? 'cursor-pointer' : undefined}
            onClick={() => onSelectBooking?.(b.id)}
          >
            <ListRow title={title} meta={meta} aside={aside} chevron={false} />
          </div>
        )
      })}
    </div>
  )
}
