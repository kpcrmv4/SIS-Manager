'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from './responsive-dialog'
import { rejectBooking } from '@/lib/booking/actions'

export function RejectDialog({
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
      const res = await rejectBooking(bookingId, reason)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(tc('saved'))
      setReason('')
      onOpenChange(false)
      onDone()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={tc('reject')}>
      <label className="label-base" htmlFor="rej-reason">
        {t('rejectReason')}
      </label>
      <textarea
        id="rej-reason"
        className="input-base mb-4 min-h-20"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button type="button" className="btn-danger" disabled={pending} onClick={submit} data-testid="reject-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('reject')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
