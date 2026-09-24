'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { deletePushSubscription, savePushSubscription, sendTestPush } from '@/lib/push/actions'
import { appEnv } from './platform'

export type PushState = 'loading' | 'unsupported' | 'install-first' | 'denied' | 'off' | 'on'

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function readState(): Promise<PushState> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  // iPhone / iPad Safari only offers push to an app added to the home screen
  if (!supported) return appEnv() === 'ios' ? 'install-first' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/**
 * Web push on this device (P4-03) — shared by the /me card and the bell sheet (R-043). The
 * state is read again whenever the app comes back to the front: someone who allowed
 * notifications in the phone's settings sees it without a reload. The subscription is stored
 * as the user's own row.
 */
export function usePush() {
  const t = useTranslations('me')
  const te = useTranslations('common')
  const [state, setState] = useState<PushState>('loading')
  const [pending, start] = useTransition()

  useEffect(() => {
    let alive = true
    const check = () =>
      void readState().then((s) => {
        if (alive) setState(s)
      })
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
    }
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

  return { state, pending, enable, disable, test }
}
