'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import type { CustomerLocale } from '@/lib/i18n/config'
import { daysUntil, formatShortDate } from '@/lib/date'
import { CxEmpty, CxErrorRetry, CxLoader } from './cx-states'
import { customerFetch, useCxSession } from './session-context'
import { WithdrawSheet } from './withdraw-sheet'

type Bottle = { id: string; bottle_no: number; remaining_percent: number; status: string }
export type Deposit = {
  id: string
  code: string
  item_name: string
  quantity: number
  remaining_qty: number
  remaining_percent: number
  status: string
  is_vip: boolean
  expires_at: string | null
  collect_deadline_at: string | null
  table_label: string | null
  deposit_bottles: Bottle[]
}
type DepositsResponse = { deposits: Deposit[]; blockedToday: boolean; branch: { depositDays: number; blockedDays: string[] } }

const ACTIVE = new Set(['requested', 'pending_confirm', 'in_store', 'pending_withdrawal'])
const METERED = new Set(['in_store', 'pending_withdrawal'])

/** "เหล้าของฉัน" (P2-C2): active/history tabs, one card per deposit, "ขอเบิกเหล้า" opens the sheet. */
export function MyBottlesClient() {
  const t = useTranslations('cx')
  // dates follow the language on screen (the session's locale is only the one at sign-in)
  const locale = useLocale() as CustomerLocale
  const session = useCxSession()
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [data, setData] = useState<DepositsResponse | null>(null)
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [withdrawFor, setWithdrawFor] = useState<Deposit | null>(null)

  const load = useCallback(() => {
    setState('loading')
    customerFetch(`/api/customer/deposits?branch=${session.branch.code}`, session)
      .then((res) => {
        if (!res.ok) throw new Error('load failed')
        return res.json() as Promise<DepositsResponse>
      })
      .then((d) => {
        setData(d)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [session])

  useEffect(() => {
    // Fetch-on-mount: load() sets 'loading' synchronously, which is the point (an immediate
    // skeleton, not one frame of stale content) — not the effect subscribing to an external store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  if (state === 'loading') return <CxLoader label={t('bottles.loading')} />
  if (state === 'error') return <CxErrorRetry message={t('shell.errorGeneric')} onRetry={load} />

  const deposits = data?.deposits ?? []
  const active = deposits.filter((d) => ACTIVE.has(d.status))
  const history = deposits.filter((d) => !ACTIVE.has(d.status))
  const list = tab === 'active' ? active : history
  const depositHref = `/liff/${session.branch.code.toLowerCase()}/deposit`
  // nothing stored: the empty state is itself the way to deposit (a faint dashed frame, owner)
  const nothingStored = tab === 'active' && active.length === 0

  return (
    <div className="flex flex-col gap-3">
      <div className="cx-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')} data-testid="cx-tab-active">
          {t('bottles.tabActive', { count: active.length })}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} data-testid="cx-tab-history">
          {t('bottles.tabHistory')}
        </button>
      </div>

      {nothingStored ? (
        <>
          <Link href={depositHref} className="cx-add-card" data-testid="cx-deposit-cta">
            <i className="cx-add-icon">
              <Plus className="size-6" aria-hidden />
            </i>
            <b>{t('bottles.depositCta')}</b>
            <span>{t('bottles.depositCtaBody')}</span>
          </Link>
          <p className="px-3 text-center text-xs leading-relaxed text-cx-muted">{t('bottles.emptyBody')}</p>
        </>
      ) : list.length === 0 ? (
        <CxEmpty title={t('bottles.historyEmpty')} />
      ) : (
        list.map((d) => (
          <DepositCard key={d.id} deposit={d} locale={locale} onWithdraw={() => setWithdrawFor(d)} />
        ))
      )}

      {!nothingStored && (
        <Link href={depositHref} className="cx-btn add" data-testid="cx-deposit-more">
          <Plus className="size-4.5" aria-hidden />
          {t('bottles.depositMore')}
        </Link>
      )}

      {withdrawFor && (
        <WithdrawSheet
          deposit={withdrawFor}
          blockedToday={data?.blockedToday ?? false}
          onClose={() => setWithdrawFor(null)}
          onDone={() => {
            setWithdrawFor(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function DepositCard({ deposit: d, locale, onWithdraw }: { deposit: Deposit; locale: CustomerLocale; onWithdraw: () => void }) {
  const t = useTranslations('cx')
  const terminal = !ACTIVE.has(d.status)
  const deadline = d.collect_deadline_at ?? d.expires_at
  const daysLeft = !terminal && !d.is_vip && d.expires_at ? daysUntil(d.expires_at) : null
  const nearExpiry = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7

  return (
    <div className="cx-card" data-testid="cx-deposit-card" data-code={d.code} data-status={d.status}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-semibold">{d.item_name}</span>
        {d.is_vip ? (
          <span className="cx-pill">{t('bottles.vip')}</span>
        ) : nearExpiry ? (
          <span className="cx-pill warn">{t('bottles.daysLeft', { count: daysLeft })}</span>
        ) : (
          <span className="cx-pill">{t('bottles.count', { count: d.quantity })}</span>
        )}
      </div>

      {METERED.has(d.status) && <div className="cx-meter"><i style={{ width: `${d.remaining_percent}%` }} /></div>}

      <div className="meta num flex items-center justify-between gap-2 text-[12.5px] text-cx-muted">
        <span className="cx-code">{d.code}</span>
        {terminal && <span>{t(`bottles.status.${d.status}`)}</span>}
        {METERED.has(d.status) &&
          (d.is_vip ? <span className="cx-gold">{t('bottles.noExpiry')}</span> : <span>{t('bottles.collectBy', { date: deadline ? formatShortDate(deadline, locale) : '—' })}</span>)}
      </div>

      {d.status === 'requested' && <p className="text-xs text-cx-muted">{t('bottles.requested')}</p>}
      {d.status === 'pending_confirm' && <p className="text-xs text-cx-muted">{t('bottles.awaitingConfirm')}</p>}
      {d.status === 'pending_withdrawal' && <p className="text-xs text-cx-muted">{t('bottles.withdrawPending')}</p>}
      {d.status === 'in_store' && (
        <button type="button" className="cx-btn" onClick={onWithdraw} data-testid="cx-withdraw-open">
          {t('bottles.requestWithdraw')}
        </button>
      )}
    </div>
  )
}
