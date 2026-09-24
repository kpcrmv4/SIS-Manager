'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { BellOff, BellRing, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import type { Role } from '@/lib/auth/actor'
import { deletePushSubscription, savePushSubscription, sendTestPush } from '@/lib/push/actions'
import { kindsFor } from '@/lib/push/kinds'
import { appEnv } from './platform'

type State = 'loading' | 'unsupported' | 'install-first' | 'denied' | 'off' | 'on'

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * /me — web push on this device (P4-03). The subscription is stored as the user's own row.
 * The card says what this role is told about (R-042) — the same map the database follows.
 */
export function PushToggle({ role }: { role: Role }) {
  const t = useTranslations('me')
  const te = useTranslations('common')
  const [state, setState] = useState<State>('loading')
  const [pending, start] = useTransition()

  useEffect(() => {
    // The browser's capabilities are only readable after mount (the server renders 'loading'),
    // so the first answer is set here — reading an external system, not reacting to our render.
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!supported) {
      // iPhone / iPad Safari only offers push to an app added to the home screen
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(appEnv() === 'ios' ? 'install-first' : 'unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : 'off'))
      .catch(() => setState('off'))
  }, [])

  function enable() {
    start(async () => {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) }))
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
        const res = await savePushSubscription(json)
        if (!res.ok) throw new Error(res.error)
        setState('on')
        toast.success(t('pushEnabled'))
      } catch {
        toast.error(te('errorGeneric'))
      }
    })
  }

  function disable() {
    start(async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          const res = await deletePushSubscription(sub.endpoint)
          if (!res.ok) throw new Error(res.error)
          await sub.unsubscribe()
        }
        setState('off')
        toast.success(t('pushDisabled'))
      } catch {
        toast.error(te('errorGeneric'))
      }
    })
  }

  function test() {
    start(async () => {
      const res = await sendTestPush()
      if (res.ok) toast.success(t('pushTestSent'))
      else if (res.error === 'no_device') toast.error(t('pushTestNoDevice'))
      else if (res.error === 'too_soon') toast.error(t('pushTestTooSoon'))
      else if (res.error === 'not_configured') toast.error(t('pushNotConfigured'))
      else toast.error(te('errorGeneric'))
    })
  }

  return (
    <section className="card-surface p-4" data-testid="push-toggle" data-state={state}>
      <h2 className="mb-1 text-[15px] font-semibold">{t('push')}</h2>
      <p className="mb-3 text-sm text-muted-token">{t('pushHint')}</p>

      <div className="mb-3 rounded-lg bg-surface-2 px-3 py-2.5" data-testid="push-kinds">
        <p className="mb-1.5 text-xs font-semibold text-ink-2">{t('pushWhat', { scope: t(role === 'owner' ? 'pushScopeOwner' : 'pushScopeMember') })}</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
          {kindsFor(role).map((k) => (
            <li key={k} data-kind={k}>
              {t(`pushKinds.${k}`)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-token">{t('pushBadge')}</p>
      </div>

      {state === 'unsupported' && <p className="text-sm text-ink-2">{t('pushUnsupported')}</p>}
      {state === 'install-first' && <p className="text-sm text-ink-2" data-testid="push-install-first">{t('pushIosInstall')}</p>}
      {state === 'denied' && <p className="text-sm text-urgent">{t('pushDenied')}</p>}
      {(state === 'off' || state === 'loading') && (
        <button type="button" className="btn-primary" onClick={enable} disabled={pending || state === 'loading'} data-testid="push-enable">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BellRing className="size-4" aria-hidden />}
          {t('pushOn')}
        </button>
      )}
      {state === 'on' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={test} disabled={pending} data-testid="push-test">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {t('pushTest')}
          </button>
          <button type="button" className="btn-ghost" onClick={disable} disabled={pending} data-testid="push-disable">
            <BellOff className="size-4" aria-hidden />
            {t('pushOff')}
          </button>
        </div>
      )}
    </section>
  )
}
