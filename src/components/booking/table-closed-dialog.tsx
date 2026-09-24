'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2, LockOpen } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from './responsive-dialog'
import { setTableClosed } from '@/lib/booking/actions'
import { formatShortDate, type AppLocale } from '@/lib/date'

/** A table closed for the night (ปิดจอง, R-056): bar / owner open it to bookings again. */
export function TableClosedDialog({
  open,
  onOpenChange,
  tableId,
  tableLabel,
  night,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tableId: string
  tableLabel: string
  night: string
  onDone: () => void
}) {
  const t = useTranslations('bookings')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const locale = useLocale() as AppLocale
  const [pending, start] = useTransition()

  function reopen() {
    start(async () => {
      const res = await setTableClosed(tableId, night, false)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('reopened', { table: tableLabel }))
      onOpenChange(false)
      onDone()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('closedTitle', { table: tableLabel })}>
      <p className="mb-4 text-sm text-ink-2">{t('closedBody', { date: formatShortDate(night, locale) })}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('close')}
        </button>
        <button type="button" className="btn-primary" disabled={pending} onClick={reopen} data-testid="reopen-table-button">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
          {t('reopen')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
