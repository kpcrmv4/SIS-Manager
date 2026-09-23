'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { disposeDeposits } from '@/lib/deposit/actions'

/** bar/owner: bulk (or single) dispose of expired deposits — irreversible, notifies each customer. */
export function DisposeDialog({
  open,
  onOpenChange,
  depositIds,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  depositIds: string[]
  onDone?: () => void
}) {
  const t = useTranslations('disposeDialog')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()
  const count = depositIds.length

  function submit() {
    start(async () => {
      const res = await disposeDeposits(depositIds, reason)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('done', { count: res.data?.count ?? count }))
      onOpenChange(false)
      onDone?.()
    })
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { count })}
      description={t('body')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-danger" onClick={submit} disabled={pending || !count} data-testid="dispose-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('submit')}
          </button>
        </>
      }
    >
      <label className="label-base" htmlFor="dispose-reason">
        {t('reason')}
      </label>
      <input id="dispose-reason" className="input-base" placeholder={t('reasonDefault')} value={reason} onChange={(e) => setReason(e.target.value)} />
    </ActionDialog>
  )
}
