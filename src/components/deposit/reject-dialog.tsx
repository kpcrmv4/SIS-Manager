'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { rejectDeposit } from '@/lib/deposit/actions'

/** bar/owner: reject a deposit request (requested or pending_confirm) — always ends `cancelled`. */
export function RejectDialog({ open, onOpenChange, depositId }: { open: boolean; onOpenChange: (v: boolean) => void; depositId: string }) {
  const t = useTranslations('rejectDialog')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await rejectDeposit(depositId, reason)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('done'))
      onOpenChange(false)
    })
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('body')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-danger" onClick={submit} disabled={pending} data-testid="reject-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('submit')}
          </button>
        </>
      }
    >
      <label className="label-base" htmlFor="reject-reason">
        {t('reason')}
      </label>
      <textarea id="reject-reason" className="input-base" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
    </ActionDialog>
  )
}
