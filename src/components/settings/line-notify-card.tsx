'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowUpFromLine,
  Ban,
  Bell,
  BellRing,
  CalendarCheck,
  CalendarClock,
  CalendarMinus,
  CalendarPlus,
  CalendarX,
  Check,
  CircleX,
  ClipboardCheck,
  GlassWater,
  Loader2,
  MessageSquarePlus,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { setLineNotify } from '@/lib/settings/line-notify-actions'

const ICON: Record<string, LucideIcon> = {
  deposit_confirmed: ClipboardCheck,
  deposit_rejected: CircleX,
  withdraw_completed: GlassWater,
  withdraw_rejected: Ban,
  disposed: Trash2,
  booking_pending: CalendarClock,
  booking_confirmed: CalendarCheck,
  booking_rejected: CalendarX,
  booking_cancelled: CalendarMinus,
  booking_reminder: BellRing,
  deposit_requested: MessageSquarePlus,
  withdrawal_requested: ArrowUpFromLine,
  booking_new: CalendarPlus,
}
// the hue of the work it is about — the same as that work's filter card (R-047)
const TONE: Record<string, string> = {
  deposit_confirmed: 'bg-status-done-bg text-status-done',
  deposit_rejected: 'bg-urgent-bg text-urgent',
  withdraw_completed: 'bg-status-violet-bg text-status-violet',
  withdraw_rejected: 'bg-urgent-bg text-urgent',
  disposed: 'bg-urgent-bg text-urgent',
  booking_pending: 'bg-status-progress-bg text-status-progress',
  booking_confirmed: 'bg-status-info-bg text-status-info',
  booking_rejected: 'bg-urgent-bg text-urgent',
  booking_cancelled: 'bg-urgent-bg text-urgent',
  booking_reminder: 'bg-status-info-bg text-status-info',
  deposit_requested: 'bg-gold-bg text-gold-ink',
  withdrawal_requested: 'bg-gold-bg text-gold-ink',
  booking_new: 'bg-gold-bg text-gold-ink',
}

type Quota = { state: 'ok'; limit: number | null; used: number } | { state: 'no_token' } | { state: 'error' }

/**
 * R-063 · แจ้งเตือนอัตโนมัติทาง LINE: this month's push allowance of the branch's OA, then a switch
 * for every automatic message — to customers, and to the staff group. A switch saves at once.
 */
export function LineNotifyCard({ branchId, initialOff, kinds, quota }: { branchId: string; initialOff: string[]; kinds: { customer: readonly string[]; group: readonly string[] }; quota: Quota }) {
  const t = useTranslations('settingsBranch.notify')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
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

  // a card per message: tap it to switch; off reads faded, dashed and grey (owner, 2026-09-27).
  // On a phone only the icon, the name and the state — the "when" line comes back from `sm` up.
  const group = (title: string, list: readonly string[]) => (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold text-muted-token">{title}</h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.map((k) => {
          const on = !off.includes(k)
          const Icon = ICON[k] ?? Bell
          return (
            <li key={k} data-testid="notify-row" data-kind={k} data-on={on ? 'true' : 'false'}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={t(`kind.${k}`)}
                title={t(`when.${k}`)}
                disabled={busy === k}
                onClick={() => toggle(k)}
                className={`flex h-full w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left transition duration-150 active:scale-[0.98] disabled:cursor-wait ${
                  on ? 'border-line bg-card shadow-e1 hover:border-line-strong' : 'border-dashed border-line bg-surface-2 opacity-55 hover:opacity-75'
                }`}
                data-testid={`notify-switch-${k}`}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-[9px] ${on ? TONE[k] ?? 'bg-surface-2 text-ink-2' : 'bg-line-soft text-muted-token'}`} aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${on ? 'bg-status-done-bg text-status-done' : 'bg-line-soft text-muted-token'}`}
                    aria-hidden
                  >
                    {busy === k ? <Loader2 className="size-3 animate-spin" /> : on ? <Check className="size-3" strokeWidth={3} /> : null}
                    {on ? tc('on') : tc('off')}
                  </span>
                </span>
                <span className="text-[13px] font-semibold leading-snug text-ink">{t(`kind.${k}`)}</span>
                <span className="hidden text-xs leading-snug text-muted-token sm:block">{t(`when.${k}`)}</span>
              </button>
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
