'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CircleAlert, CircleCheck, UserPlus, Wine } from 'lucide-react'
import { CxLoader } from './cx-states'
import { customerFetch, useCxSession } from './session-context'

type Linked = { already: boolean; returning: boolean; code: string; linked: number; name: string | null; addFriendUrl: string | null }
type State = { kind: 'loading' } | { kind: 'done'; r: Linked } | { kind: 'failed'; error: string }

const KNOWN_ERRORS = new Set(['EXPIRED', 'NOT_YOURS', 'BAD_STATE', 'THROTTLED'])

/**
 * R-058 · after the scan. The shell has already logged the customer in with LIFF; this page spends
 * the one-time token once (a remount must not spend it twice), then says what happened: welcome back
 * or linked for the first time, how many deposits, and — for a new customer — adding the bar as a
 * friend, without which no expiry reminder can reach them.
 */
export function LinkClient({ token }: { token: string }) {
  const t = useTranslations('cx')
  const session = useCxSession()
  const sent = useRef(false)
  const [state, setState] = useState<State>(() => (token ? { kind: 'loading' } : { kind: 'failed', error: 'missing' }))

  useEffect(() => {
    if (!token || sent.current) return
    sent.current = true
    customerFetch(`/api/customer/link?branch=${session.branch.code}`, session, { method: 'POST', body: JSON.stringify({ token }) })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<Linked> & { error?: string }
        if (res.ok) setState({ kind: 'done', r: body as Linked })
        else setState({ kind: 'failed', error: body.error && KNOWN_ERRORS.has(body.error) ? body.error : 'generic' })
      })
      .catch(() => setState({ kind: 'failed', error: 'generic' }))
  }, [token, session])

  const home = `/liff/${session.branch.code.toLowerCase()}`
  const toBottles = (
    <Link href={home} className="cx-btn" data-testid="cx-link-bottles">
      <Wine className="size-4.5" aria-hidden />
      {t('link.myBottles')}
    </Link>
  )

  if (state.kind === 'loading') return <CxLoader label={t('link.loading')} testId="cx-link-loading" />

  if (state.kind === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        <div className="cx-card items-center gap-3 py-8 text-center" data-testid="cx-link-failed" data-error={state.error}>
          <CircleAlert className="size-9 text-cx-danger" aria-hidden />
          <p className="text-sm">{state.error === 'generic' ? t('shell.errorGeneric') : t(`link.${state.error}`)}</p>
        </div>
        {toBottles}
      </div>
    )
  }

  const { r } = state
  const name = r.name ?? session.customer.display_name ?? ''
  return (
    <div className="flex flex-col gap-3">
      <div className="cx-card items-center gap-2 py-7 text-center" data-testid="cx-link-done" data-returning={r.returning ? 'true' : 'false'} data-linked={r.linked}>
        <CircleCheck className="size-10 text-cx-gold" aria-hidden />
        <p className="cx-serif text-lg font-semibold">{r.returning && name ? t('link.welcomeBack', { name }) : t('link.welcomeNew')}</p>
        {r.linked > 0 ? (
          <p className="text-sm tnum" data-testid="cx-link-count">
            {t('link.linked', { count: r.linked })}
          </p>
        ) : (
          r.already && (
            <p className="text-sm" data-testid="cx-link-already">
              {t('link.already', { code: r.code })}
            </p>
          )
        )}
        <p className="text-xs leading-relaxed text-cx-muted">{t('link.linkedBody')}</p>
      </div>
      {!r.returning && r.addFriendUrl && (
        <a href={r.addFriendUrl} className="cx-card flex-row items-center gap-3" data-testid="cx-link-add-friend">
          <UserPlus className="size-6 flex-none text-cx-gold" aria-hidden />
          <span className="min-w-0">
            <b className="block text-sm">{t('link.addFriend')}</b>
            <span className="text-xs text-cx-muted">{t('link.addFriendBody')}</span>
          </span>
        </a>
      )}
      {toBottles}
    </div>
  )
}
