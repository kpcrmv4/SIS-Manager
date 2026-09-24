'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from './responsive-dialog'
import { markNoShow } from '@/lib/booking/actions'

/**
 * ไม่มา · ปล่อยโต๊ะ (bar / owner, R-053): a confirmed guest past their time is a no-show now and the
 * table is free for someone else. They can still be checked in if they turn up after all.
 */
export function NoShowDialog({
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
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await markNoShow(bookingId)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('noShowDone'))
      onOpenChange(false)
      onDone()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('noShow')}>
      <p className="mb-4 text-sm text-ink-2">{t('noShowBody')}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('close')}
        </button>
        <button type="button" className="btn-danger" disabled={pending} onClick={submit} data-testid="no-show-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('noShow')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
