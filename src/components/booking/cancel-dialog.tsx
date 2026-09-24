'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from './responsive-dialog'
import { cancelBooking } from '@/lib/booking/actions'

/** ยกเลิกการจอง (bar / owner, R-039): the customer is told on LINE and the table is free again. */
export function CancelDialog({
  open,
  onOpenChange,
  bookingId,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  bookingId: string
  onDone: () => void
}) {
  const t = useTranslations('booking')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await cancelBooking(bookingId, reason)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('cancelled'))
      setReason('')
      onOpenChange(false)
      onDone()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('cancel')}>
      <p className="mb-3 text-sm text-ink-2">{t('cancelBody')}</p>
      <label className="label-base" htmlFor="cancel-reason">
        {t('cancelReason')}
      </label>
      <textarea
        id="cancel-reason"
        className="input-base mb-4 min-h-20"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('close')}
        </button>
        <button type="button" className="btn-danger" disabled={pending} onClick={submit} data-testid="cancel-booking-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('cancel')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
