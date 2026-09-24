'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { getBookingDetail } from '@/lib/booking/actions'
import type { BookingDetail } from '@/lib/booking/actions'
import { BookingSheetContent } from './booking-sheet-content'
import { ListSkeleton } from '@/components/ui/states'
import { ErrorRetry } from '@/components/ui/error-retry'
import type { AppLocale } from '@/lib/date'

/**
 * Scan result for a booking ticket QR / booking number / table (P2-B2). The
 * scan page renders this inline (no dialog chrome) — /bookings reuses the
 * same BookingSheetContent inside a dialog (booking-detail-dialog.tsx).
 */
export function ScanResultBooking({ bookingId, branchId, onDone }: { bookingId: string; branchId: string; onDone: () => void }) {
  const t = useTranslations('scan')
  const locale = useLocale() as AppLocale
  const router = useRouter()
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

  return (
    <div className="card-surface p-4" data-testid="scan-result-booking">
      <div className="mb-2 text-sm font-semibold text-muted-token">{t('resultBooking')}</div>
      {state.status === 'loading' && <ListSkeleton rows={1} />}
      {state.status === 'error' && <ErrorRetry onRetry={() => void load()} />}
      {state.status === 'ok' && (
        <BookingSheetContent
          detail={state.detail}
          branchId={branchId}
          locale={locale}
          canChangeTable={state.detail.canChangeTable}
          canCancel={state.detail.canCancel}
          // check-in / cancel update the card in place (the button becomes "เช็กอินแล้ว");
          // only "ปิด" clears the result back to the search box (onDone)
          onChanged={() => router.refresh()}
          onClose={onDone}
        />
      )}
    </div>
  )
}
