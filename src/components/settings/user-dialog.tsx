'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { createStaffUser, updateStaffUser } from '@/lib/settings/users-api'
import type { UsersApiError } from '@/lib/settings/users-api'

type Role = 'staff' | 'bar' | 'owner'

export type UserDialogValue = {
  id?: string
  username: string
  displayName: string
  role: Role
  branchIds: string[]
  active: boolean
}

export function UserDialog({
  open,
  onOpenChange,
  branches,
  initial,
  isSelf,
  onSaved,
  loginUrl = '',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branches: { id: string; name: string }[]
  initial: UserDialogValue
  isSelf: boolean
  onSaved: () => void
  /** R-081: the sign-in address, for the summary handed to the new person */
  loginUrl?: string
}) {
  const t = useTranslations('settingsUsers')
  const tc = useTranslations('common')
  const tr = useTranslations('roles')
  const [v, setV] = useState(initial)
  const [password, setPassword] = useState('')
  const [pending, start] = useTransition()
  // R-081: after creating — username, password and the sign-in link, ready to copy and send
  const [created, setCreated] = useState<string | null>(null)

  function errorText(code: UsersApiError) {
    switch (code) {
      case 'username_taken':
        return t('errorUsernameTaken')
      case 'password_too_short':
        return t('errorPasswordShort')
      case 'cannot_change_self':
        return t('errorCannotChangeSelf')
      case 'not_found':
        return t('errorNotFound')
      default:
        return t('errorUnavailable')
    }
  }

  function toggleBranch(id: string) {
    setV((s) => ({ ...s, branchIds: s.branchIds.includes(id) ? s.branchIds.filter((b) => b !== id) : [...s.branchIds, id] }))
  }

  function submit() {
    start(async () => {
      const res = initial.id
        ? await updateStaffUser({ userId: initial.id, displayName: v.displayName, role: isSelf ? undefined : v.role, active: isSelf ? undefined : v.active, branchIds: v.branchIds })
        : await createStaffUser({ username: v.username, displayName: v.displayName, role: v.role, branchIds: v.branchIds, password })
      if (!res.ok) {
        toast.error(errorText(res.error))
        return
      }
      toast.success(initial.id ? tc('saved') : t('created'))
      onSaved()
      if (!initial.id) {
        setCreated(t('summaryText', { name: v.displayName.trim(), username: v.username.trim().toLowerCase(), password, url: loginUrl || '—' }))
        return
      }
      onOpenChange(false)
    })
  }

  if (created) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('summaryTitle')} width={480}>
        <p className="mb-2 text-sm text-muted-token">{t('summaryBody')}</p>
        <textarea readOnly className="input-base min-h-32 font-medium tnum" value={created} onFocus={(e) => e.currentTarget.select()} data-testid="user-created-summary" />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)} data-testid="user-created-close">
            {tc('close')}
          </button>
          <CopyButton text={created} label={t('summaryCopy')} done={t('summaryCopied')} testId="user-created-copy" />
        </div>
      </ResponsiveDialog>
    )
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={initial.id ? tc('edit') : t('addUser')} width={480}>
      <div className="flex flex-col gap-3">
        {!initial.id && (
          <div>
            <label className="label-base" htmlFor="ud-username">
              {t('username')}
            </label>
            <input id="ud-username" className="input-base" value={v.username} onChange={(e) => setV((s) => ({ ...s, username: e.target.value }))} maxLength={32} />
            <p className="help-text">{t('usernameHelp')}</p>
          </div>
        )}
        <div>
          <label className="label-base" htmlFor="ud-name">
            {t('displayName')}
          </label>
          <input id="ud-name" className="input-base" value={v.displayName} onChange={(e) => setV((s) => ({ ...s, displayName: e.target.value }))} maxLength={80} />
        </div>
        {!isSelf && (
          <div>
            <label className="label-base" htmlFor="ud-role">
              {t('role')}
            </label>
            <select id="ud-role" className="input-base" value={v.role} onChange={(e) => setV((s) => ({ ...s, role: e.target.value as Role }))}>
              <option value="staff">{tr('staff')}</option>
              <option value="bar">{tr('bar')}</option>
              <option value="owner">{tr('owner')}</option>
            </select>
          </div>
        )}
        <div>
          <label className="label-base">{t('branches')}</label>
          <div className="flex flex-col gap-1.5">
            {branches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={v.branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                {b.name}
              </label>
            ))}
          </div>
        </div>
        {!initial.id && (
          <div>
            <label className="label-base" htmlFor="ud-password">
              {t('password')}
            </label>
            <input id="ud-password" type="password" className="input-base" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
            <p className="help-text">{t('passwordHelp')}</p>
          </div>
        )}
        {initial.id && !isSelf && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">{t('active')}</span>
            <button type="button" role="switch" aria-checked={v.active} aria-label={t('active')} className="tg" onClick={() => setV((s) => ({ ...s, active: !s.active }))} />
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !v.displayName.trim() || (!initial.id && (!v.username.trim() || password.length < 8))}
          onClick={submit}
          data-testid="user-dialog-submit"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('save')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
