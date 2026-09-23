'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { setVip } from '@/lib/deposit/actions'

/** bar/owner: toggle VIP (no expiry while on; extend/expiry logic resumes when off — DESIGN.md). */
export function VipDialog({
  open,
  onOpenChange,
  depositId,
  isVip,
  depositDays,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  depositId: string
  isVip: boolean
  depositDays: number
}) {
  const t = useTranslations('vipDialog')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await setVip(depositId, !isVip)
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
      title={isVip ? t('titleOff') : t('titleOn')}
      description={isVip ? t('bodyOff', { days: depositDays }) : t('bodyOn')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending} data-testid="vip-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {tc('confirm')}
          </button>
        </>
      }
    />
  )
}
