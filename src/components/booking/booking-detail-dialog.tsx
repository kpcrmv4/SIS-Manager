'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ResponsiveDialog } from './responsive-dialog'
import { BookingSheetContent } from './booking-sheet-content'
import { getBookingDetail } from '@/lib/booking/actions'
import type { BookingDetail } from '@/lib/booking/actions'
import { ListSkeleton } from '@/components/ui/states'
import { ErrorRetry } from '@/components/ui/error-retry'
import type { AppLocale } from '@/lib/date'

/** The same booking sheet as the scan result, reached by tapping a booked cell or a list row on /bookings. */
export function BookingDetailDialog({
  bookingId,
  branchId,
  locale,
  onOpenChange,
  onChanged,
}: {
  bookingId: string
  branchId: string
  locale: AppLocale
  onOpenChange: (v: boolean) => void
  onChanged: () => void
}) {
  const t = useTranslations('booking')
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ok'; detail: BookingDetail }>({ status: 'loading' })

  async function load() {
    setState({ status: 'loading' })
    const res = await getBookingDetail(branchId, bookingId)
    setState(res.ok ? { status: 'ok', detail: res.data } : { status: 'error' })
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, branchId])

  const title = state.status === 'ok' ? state.detail.code : t('time')

  return (
    <ResponsiveDialog open onOpenChange={onOpenChange} title={title}>
      {state.status === 'loading' && <ListSkeleton rows={1} />}
      {state.status === 'error' && <ErrorRetry onRetry={() => void load()} />}
      {state.status === 'ok' && (
        <BookingSheetContent
          detail={state.detail}
          branchId={branchId}
          locale={locale}
          canChangeTable={state.detail.canChangeTable}
          onCheckedIn={onChanged}
          onClose={() => onOpenChange(false)}
        />
      )}
    </ResponsiveDialog>
  )
}
