'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { checkInBooking } from '@/lib/booking/actions'

/** "มาแล้ว" — checks a confirmed booking in for tonight (booking's own scan flow is P2-B2; this is the tonight-list shortcut). */
export function CheckInButton({ branchId, bookingId, code }: { branchId: string; bookingId: string; code: string }) {
  const ts = useTranslations('status')
  const te = useTranslations('errors')
  const [pending, start] = useTransition()

  function go() {
    start(async () => {
      const res = await checkInBooking(branchId, code)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
    })
  }

  return (
    <button type="button" className="btn-ok btn-sm" onClick={go} disabled={pending} data-testid={`checkin-${bookingId}`}>
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {ts('booking.arrived')}
    </button>
  )
}
