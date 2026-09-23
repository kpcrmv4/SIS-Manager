'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

type Err = 'passwordMismatch' | 'passwordWrong' | 'passwordTooShort' | null

export function PasswordForm() {
  const t = useTranslations('me')
  const tc = useTranslations('common')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Err>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const current = String(fd.get('current') ?? '')
    const next = String(fd.get('next') ?? '')
    if (next.length < 8) return setError('passwordTooShort')
    if (next !== String(fd.get('confirm') ?? '')) return setError('passwordMismatch')
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.ok) {
        toast.success(t('passwordChanged'))
        form.reset()
      } else if (data.error === 'wrong_password') setError('passwordWrong')
      else if (data.error === 'too_short') setError('passwordTooShort')
      else toast.error(tc('errorGeneric'))
    } catch {
      toast.error(tc('errorGeneric'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="card-surface flex flex-col gap-3 p-4" noValidate>
      <h2 className="text-[15px] font-semibold">{t('changePassword')}</h2>
      <div>
        <label htmlFor="pw-current" className="label-base">{t('currentPassword')}</label>
        <input id="pw-current" name="current" type="password" autoComplete="current-password" className="input-base" required />
      </div>
      <div>
        <label htmlFor="pw-next" className="label-base">{t('newPassword')}</label>
        <input id="pw-next" name="next" type="password" autoComplete="new-password" className="input-base" required minLength={8} />
      </div>
      <div>
        <label htmlFor="pw-confirm" className="label-base">{t('confirmPassword')}</label>
        <input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" className="input-base" required />
      </div>
      {error && <p role="alert" className="text-sm text-urgent">{t(error)}</p>}
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('save')}
        </button>
      </div>
    </form>
  )
}
