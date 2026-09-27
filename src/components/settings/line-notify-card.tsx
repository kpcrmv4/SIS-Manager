'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { setLineNotify } from '@/lib/settings/line-notify-actions'

type Quota = { state: 'ok'; limit: number | null; used: number } | { state: 'no_token' } | { state: 'error' }

/**
 * R-063 · แจ้งเตือนอัตโนมัติทาง LINE: this month's push allowance of the branch's OA, then a switch
 * for every automatic message — to customers, and to the staff group. A switch saves at once.
 */
export function LineNotifyCard({ branchId, initialOff, kinds, quota }: { branchId: string; initialOff: string[]; kinds: { customer: readonly string[]; group: readonly string[] }; quota: Quota }) {
  const t = useTranslations('settingsBranch.notify')
  const te = useTranslations('errors')
  const [off, setOff] = useState<string[]>(initialOff)
  const [busy, setBusy] = useState<string | null>(null)
  const [, start] = useTransition()

  function toggle(kind: string) {
    const on = off.includes(kind)
    setBusy(kind)
    start(async () => {
      const res = await setLineNotify(branchId, kind, on)
      setBusy(null)
      if (!res.ok) {
        toast.error(te(res.error === 'forbidden' ? 'FORBIDDEN' : 'invalid'))
        return
      }
      setOff(res.off)
      toast.success(on ? t('savedOn', { name: t(`kind.${kind}`) }) : t('savedOff', { name: t(`kind.${kind}`) }))
    })
  }

  const group = (title: string, list: readonly string[]) => (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-muted-token">{title}</h3>
      <ul className="divide-y divide-line-soft rounded-md border border-line-soft">
        {list.map((k) => {
          const on = !off.includes(k)
          return (
            <li key={k} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2" data-testid="notify-row" data-kind={k} data-on={on ? 'true' : 'false'}>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{t(`kind.${k}`)}</span>
                <span className="block text-xs text-muted-token">{t(`when.${k}`)}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={t(`kind.${k}`)}
                className="tg shrink-0"
                disabled={busy === k}
                onClick={() => toggle(k)}
                data-testid={`notify-switch-${k}`}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )

  const pct = quota.state === 'ok' && quota.limit ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0
  const tight = pct >= 80

  return (
    <section className="card-surface flex flex-col gap-4 p-4" data-testid="line-notify">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{t('title')}</h2>
        <p className="text-sm text-muted-token">{t('hint')}</p>
      </div>

      <div className="rounded-md border border-line-soft bg-surface-2 p-3" data-testid="line-quota" data-state={quota.state}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-ink">{t('quotaTitle')}</span>
          {quota.state === 'ok' && (
            <span className={`text-sm tnum ${tight ? 'font-semibold text-urgent' : 'text-ink-2'}`} data-testid="line-quota-used" data-used={quota.used} data-limit={quota.limit ?? ''}>
              {quota.limit === null ? t('quotaUnlimited', { used: quota.used }) : t('quotaUsed', { used: quota.used, limit: quota.limit })}
            </span>
          )}
        </div>
        {quota.state === 'ok' && quota.limit !== null && (
          <>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" aria-hidden>
              <div className={`h-full rounded-full ${tight ? 'bg-urgent' : 'bg-status-done'}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-token tnum">{t('quotaLeft', { left: Math.max(0, quota.limit - quota.used) })}</p>
          </>
        )}
        {quota.state === 'no_token' && <p className="mt-1 text-xs text-muted-token">{t('quotaNoToken')}</p>}
        {quota.state === 'error' && <p className="mt-1 text-xs text-muted-token">{t('quotaError')}</p>}
        <p className="mt-1.5 text-xs text-muted-token">{t('quotaHelp')}</p>
      </div>

      {group(t('toCustomer'), kinds.customer)}
      {group(t('toGroup'), kinds.group)}
      <p className="help-text">{t('expiryNote')}</p>
    </section>
  )
}
