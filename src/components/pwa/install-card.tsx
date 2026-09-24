'use client'

import { useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { CircleCheck, Download, Loader2, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { installOffer, installedHere, promptInstall, subscribeInstall } from './install-prompt'
import { appEnv, noSubscribe } from './platform'

/**
 * /me — ติดตั้งแอป (R-042). Where the browser offers an install (Chrome, Edge, Samsung
 * Internet) one button opens its prompt; iPhone / iPad get the Add-to-Home-Screen steps; an
 * in-app browser is sent to Chrome or Safari; anything else gets the browser-menu hint.
 */
export function InstallCard() {
  const t = useTranslations('me')
  const env = useSyncExternalStore(noSubscribe, appEnv, () => null)
  const offer = useSyncExternalStore(subscribeInstall, installOffer, () => null)
  const justInstalled = useSyncExternalStore(subscribeInstall, installedHere, () => false)
  const [pending, setPending] = useState(false)

  const view = !env ? 'loading' : env === 'installed' || justInstalled ? 'installed' : offer ? 'offer' : env

  async function install() {
    setPending(true)
    try {
      if ((await promptInstall()) === 'accepted') toast.success(t('installAccepted'))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="card-surface p-4" data-testid="install-card" data-view={view}>
      <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
        <Smartphone className="size-4.5 text-muted-token" aria-hidden />
        {t('install')}
      </h2>
      {view === 'installed' ? (
        <p className="flex items-center gap-2 text-sm text-status-done" data-testid="install-done">
          <CircleCheck className="size-4 flex-none" aria-hidden />
          {t('installed')}
        </p>
      ) : (
        <p className="mb-3 text-sm text-muted-token">{t('installHint')}</p>
      )}
      {view === 'offer' && (
        <button type="button" className="btn-primary" onClick={() => void install()} disabled={pending} data-testid="install-button">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {t('installButton')}
        </button>
      )}
      {view === 'ios' && (
        <ol className="man-steps" data-testid="install-ios">
          {(t.raw('installIosSteps') as string[]).map((step) => (
            <li key={step}>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {view === 'in-app' && <p className="text-sm text-ink-2" data-testid="install-in-app">{t('installInApp')}</p>}
      {view === 'browser' && <p className="text-sm text-ink-2" data-testid="install-manual">{t('installManual')}</p>}
    </section>
  )
}
