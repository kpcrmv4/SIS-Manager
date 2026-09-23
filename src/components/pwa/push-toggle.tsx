'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { BellOff, BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { deletePushSubscription, savePushSubscription } from '@/lib/push/actions'

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on'

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** /me — web push on this device (P4-03). The subscription is stored as the user's own row. */
export function PushToggle() {
  const t = useTranslations('me')
  const te = useTranslations('common')
  const [state, setState] = useState<State>('loading')
  const [pending, start] = useTransition()

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!supported) {
      setState('unsupported')
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

  return (
    <section className="card-surface p-4" data-testid="push-toggle" data-state={state}>
      <h2 className="mb-1 text-[15px] font-semibold">{t('push')}</h2>
      <p className="mb-3 text-sm text-muted-token">{t('pushHint')}</p>
      {state === 'unsupported' && <p className="text-sm text-ink-2">{t('pushUnsupported')}</p>}
      {state === 'denied' && <p className="text-sm text-urgent">{t('pushDenied')}</p>}
      {(state === 'off' || state === 'loading') && (
        <button type="button" className="btn-primary" onClick={enable} disabled={pending || state === 'loading'} data-testid="push-enable">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BellRing className="size-4" aria-hidden />}
          {t('pushOn')}
        </button>
      )}
      {state === 'on' && (
        <button type="button" className="btn-ghost" onClick={disable} disabled={pending} data-testid="push-disable">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BellOff className="size-4" aria-hidden />}
          {t('pushOff')}
        </button>
      )}
    </section>
  )
}
