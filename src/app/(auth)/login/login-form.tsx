'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, LogIn } from 'lucide-react'

type ErrorKey = 'invalid' | 'inactive' | 'rateLimited' | 'errorGeneric'

const ERROR_KEY: Record<string, ErrorKey> = {
  invalid: 'invalid',
  inactive: 'inactive',
  rate_limited: 'rateLimited',
}

export function LoginForm({ next, demo }: { next: string; demo: boolean }) {
  const t = useTranslations('login')
  const tc = useTranslations('common')
  const tr = useTranslations('roles')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<ErrorKey | null>(null)

  async function post(url: string, body: unknown, tag: string) {
    setPending(tag)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        // replace, not push: Back after login must not return to the form
        window.location.replace(next)
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(ERROR_KEY[data.error ?? ''] ?? 'errorGeneric')
    } catch {
      setError('errorGeneric')
    }
    setPending(null)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    void post('/api/auth/login', { identifier: String(fd.get('identifier') ?? ''), password: String(fd.get('password') ?? '') }, 'form')
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
        <div>
          <label htmlFor="identifier" className="label-base">{t('identifier')}</label>
          <input id="identifier" name="identifier" className="input-base" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </div>
        <div>
          <label htmlFor="password" className="label-base">{t('password')}</label>
          <input id="password" name="password" type="password" className="input-base" autoComplete="current-password" required />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-urgent-bg px-3 py-2 text-sm text-urgent">
            {error === 'errorGeneric' ? tc('errorGeneric') : t(error)}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={pending !== null}>
          {pending === 'form' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
          {pending === 'form' ? t('submitting') : t('submit')}
        </button>
      </form>

      {demo && (
        <div className="border-t border-line pt-4">
          <p className="mb-2 text-xs font-medium text-muted-token">{t('demoTitle')}</p>
          <div className="grid grid-cols-3 gap-2">
            {(['staff', 'bar', 'owner'] as const).map((role) => (
              <button
                key={role}
                type="button"
                className="btn-secondary btn-sm"
                disabled={pending !== null}
                onClick={() => void post('/api/auth/demo', { role }, role)}
                data-testid={`demo-${role}`}
              >
                {pending === role && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {tr(role)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
