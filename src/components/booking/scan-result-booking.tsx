'use client'

import { useTranslations } from 'next-intl'

/**
 * Scan result for a booking ticket QR / booking number / table — P1-05 placeholder.
 * Worker B (P2-B2) replaces the body (booking sheet, "ลูกค้ามาแล้ว", the customer's
 * deposits); the signature `{ bookingId, branchId, onDone }` is the contract.
 */
export function ScanResultBooking({ bookingId }: { bookingId: string; branchId: string; onDone: () => void }) {
  const t = useTranslations('scan')
  return (
    <div className="card-surface p-4" data-testid="scan-result-booking" data-booking-id={bookingId}>
      <div className="font-semibold">{t('resultBooking')}</div>
    </div>
  )
}
