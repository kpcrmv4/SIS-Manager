'use client'

import { useTranslations } from 'next-intl'
import { BellOff, BellRing, Loader2, Send } from 'lucide-react'
import type { Role } from '@/lib/auth/actor'
import { kindsFor } from '@/lib/push/kinds'
import { usePush } from './use-push'

/**
 * /me — web push on this device (P4-03). The card says what this role is told about (R-042) —
 * the same map the database follows.
 */
export function PushToggle({ role }: { role: Role }) {
  const t = useTranslations('me')
  const { state, pending, enable, disable, test } = usePush()

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
