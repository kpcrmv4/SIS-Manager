'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { extendDeposit } from '@/lib/deposit/actions'
import { addDays, bangkokDate, formatShortDate } from '@/lib/date'

/** bar/owner: push expires_at forward N days from today (RPC recomputes collect_deadline_at). */
export function ExtendDialog({
  open,
  onOpenChange,
  depositId,
  defaultDays,
  locale,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  depositId: string
  defaultDays: number
  locale: 'th' | 'en'
}) {
  const t = useTranslations('extendDialog')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [days, setDays] = useState(defaultDays)
  const [pending, start] = useTransition()

  const newDate = addDays(bangkokDate(), Math.max(1, Math.trunc(days) || 0))

  function submit() {
    start(async () => {
      const res = await extendDeposit(depositId, days)
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
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending} data-testid="extend-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('submit')}
          </button>
        </>
      }
    >
      <label className="label-base" htmlFor="extend-days">
        {t('days')}
      </label>
      <input
        id="extend-days"
        type="number"
        min={1}
        max={365}
        inputMode="numeric"
        className="input-base w-28 tnum"
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
      />
      <p className="help-text tnum">{t('newDate', { date: formatShortDate(newDate, locale) })}</p>
    </ActionDialog>
  )
}
