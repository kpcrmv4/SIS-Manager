'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Hourglass, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { completeWithdrawals, rejectWithdrawal } from '@/lib/deposit/actions'
import type { PendingWithdrawal } from '@/lib/deposit/detail'
import { formatTime, type AppLocale } from '@/lib/date'

/**
 * The pending withdrawal request(s) on this deposit (one row per bottle — request_withdrawal
 * inserts that way): every role sees which bottles, who asked and when, so nobody asks again
 * for a customer who is only chasing it (owner, 2026-09-28); bar / owner complete or reject.
 */
export function WithdrawalPanel({ depositId, pending: rows, canDecide }: { depositId: string; pending: PendingWithdrawal[]; canDecide: boolean }) {
  const t = useTranslations('deposit')
  const tw = useTranslations('withdrawDialog')
  const locale = useLocale() as AppLocale
  const [completeOpen, setCompleteOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)

  if (!rows.length) return null
  const ids = rows.map((r) => r.id)
  const table = rows[0]?.tableLabel

  return (
    <div className="rounded-lg border border-status-violet-ring bg-status-violet-bg p-3" data-testid="withdrawal-panel" data-can-decide={canDecide}>
      <h2 className="m-0 flex items-center gap-1.5 text-sm font-semibold text-status-violet">
        <Hourglass className="size-4 shrink-0" aria-hidden />
        {t('pendingWithdrawTitle', { count: rows.length })}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col" data-testid="withdrawal-pending-row">
            <span className="text-sm font-semibold text-ink">
              {r.bottleNo !== null ? t('bottleN', { n: r.bottleNo }) : r.id} · {tw(r.type === 'in_store' ? 'typeInStore' : 'typeTakeHome')}
              {r.tableLabel ? ` · ${r.tableLabel}` : ''}
            </span>
            <span className="text-xs text-muted-token">
              {r.byCustomer ? t('requestedByCustomer') : t('requestedBy', { name: r.requestedBy ?? '—' })} · {formatTime(r.createdAt, locale)}
            </span>
          </li>
        ))}
      </ul>
      {!canDecide && (
        <p className="mt-2 text-xs text-ink-2" data-testid="withdrawal-wait-note">
          {t('pendingWithdrawWait')}
        </p>
      )}
      {canDecide && (
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ok btn-sm" onClick={() => setCompleteOpen(true)} data-testid="withdrawal-complete-open">
          {t('actionCompleteWithdraw')}
        </button>
        <button type="button" className="btn-danger btn-sm" onClick={() => setRejectOpen(true)} data-testid="withdrawal-reject-open">
          {t('actionRejectWithdraw')}
        </button>
      </div>
      )}

      <CompleteDialog open={completeOpen} onOpenChange={setCompleteOpen} depositId={depositId} withdrawalIds={ids} table={table} />
      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} depositId={depositId} withdrawalIds={ids} />
    </div>
  )
}

function CompleteDialog({
  open,
  onOpenChange,
  depositId,
  withdrawalIds,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  depositId: string
  withdrawalIds: string[]
  table: string | null
}) {
  const t = useTranslations('deposit')
  const tw = useTranslations('withdrawDialog')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await completeWithdrawals(withdrawalIds, depositId)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(tw('completed'))
      onOpenChange(false)
    })
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('actionCompleteWithdraw')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-ok" onClick={submit} disabled={pending} data-testid="withdrawal-complete-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {tw('complete')}
          </button>
        </>
      }
    />
  )
}

function RejectDialog({ open, onOpenChange, depositId, withdrawalIds }: { open: boolean; onOpenChange: (v: boolean) => void; depositId: string; withdrawalIds: string[] }) {
  const t = useTranslations('deposit')
  const tr = useTranslations('rejectDialog')
  const tw = useTranslations('withdrawDialog')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await rejectWithdrawal(withdrawalIds, depositId, reason)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(tw('rejected'))
      onOpenChange(false)
    })
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('actionRejectWithdraw')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-danger" onClick={submit} disabled={pending} data-testid="withdrawal-reject-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {tr('submit')}
          </button>
        </>
      }
    >
      <label className="label-base" htmlFor="withdrawal-reject-reason">
        {tr('reason')}
      </label>
      <textarea id="withdrawal-reject-reason" className="input-base" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
    </ActionDialog>
  )
}
