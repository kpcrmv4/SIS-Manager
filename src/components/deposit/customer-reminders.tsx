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
    <div data-testid="customer-reminders" data-on={on ? 'true' : 'false'}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-token">{t('reminders')}</span>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button type="button" role="switch" aria-checked={on} aria-label={t('reminders')} className="tg" onClick={toggle} disabled={pending} data-testid="customer-reminders-switch" />
          )}
          {/* the switch already says it; staff, who have no switch, read the state instead */}
          {!canEdit && <Badge tone={on ? 'done' : 'pending'}>{on ? t('remindersOn') : t('remindersOff')}</Badge>}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-token">{branchOff ? t('remindersBranchOff') : t('remindersHelp')}</p>
    </div>
  )
}
