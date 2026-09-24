'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { setCustomerReminders } from '@/lib/deposit/actions'

/**
 * The deposit page's "แจ้งเตือนหมดอายุ" row (R-044): this customer's LINE expiry reminders, for
 * every deposit of theirs. bar / owner switch it; staff see where it stands.
 */
export function CustomerReminders({ depositId, enabled, canEdit, branchOff }: { depositId: string; enabled: boolean; canEdit: boolean; branchOff: boolean }) {
  const t = useTranslations('deposit')
  const te = useTranslations('errors')
  const [on, setOn] = useState(enabled)
  const [pending, start] = useTransition()

  function toggle() {
    const next = !on
    start(async () => {
      const res = await setCustomerReminders(depositId, next)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      setOn(next)
      toast.success(next ? t('remindersOnDone') : t('remindersOffDone'))
    })
  }

  return (
    <div className="flex flex-col gap-1" data-testid="customer-reminders" data-on={on ? 'true' : 'false'}>
      <div className="flex items-center gap-2">
        {canEdit ? (
          <button type="button" role="switch" aria-checked={on} aria-label={t('reminders')} className="tg" onClick={toggle} disabled={pending} data-testid="customer-reminders-switch" />
        ) : null}
        <Badge tone={on ? 'done' : 'pending'}>{on ? t('remindersOn') : t('remindersOff')}</Badge>
      </div>
      <span className="text-xs text-muted-token">{branchOff ? t('remindersBranchOff') : t('remindersHelp')}</span>
    </div>
  )
}
