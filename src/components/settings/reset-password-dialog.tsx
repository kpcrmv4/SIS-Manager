'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { resetStaffPassword } from '@/lib/settings/users-api'

export function ResetPasswordDialog({
  open,
  onOpenChange,
  userId,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  userId: string
  onDone: () => void
}) {
  const t = useTranslations('settingsUsers')
  const tc = useTranslations('common')
  const [password, setPassword] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await resetStaffPassword(userId, password)
      if (!res.ok) {
        toast.error(res.error === 'password_too_short' ? t('errorPasswordShort') : t('errorUnavailable'))
        return
      }
      toast.success(tc('saved'))
      setPassword('')
      onOpenChange(false)
      onDone()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('resetPassword')}>
      <label className="label-base" htmlFor="rp-password">
        {t('password')}
      </label>
      <input id="rp-password" type="password" className="input-base mb-1" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
      <p className="help-text mb-4">{t('passwordHelp')}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button type="button" className="btn-primary" disabled={pending || password.length < 8} onClick={submit} data-testid="reset-password-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('save')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
