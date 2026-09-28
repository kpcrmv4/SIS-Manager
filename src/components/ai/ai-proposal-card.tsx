'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check, CircleX, ExternalLink, Loader2 } from 'lucide-react'
import { completeWithdrawals, extendDeposit, rejectDeposit, rejectWithdrawal, requestWithdrawal, setVip } from '@/lib/deposit/actions'
import { cancelBooking, checkInBooking, confirmBooking, createStaffBooking, rejectBooking } from '@/lib/booking/actions'
import type { Proposal, ProposalCall, ProposalState } from '@/lib/ai/proposal-types'

export type CardOutcome = { state: ProposalState; note?: string; error?: string }

/** Runs the prepared call through the app's own server action — the same one the page's button uses. */
async function execute(call: ProposalCall): Promise<{ ok: true; note?: string } | { ok: false; error: string }> {
  switch (call.fn) {
    case 'requestWithdrawal': {
      const r = await requestWithdrawal(call.args)
      return r.ok ? { ok: true } : r
    }
    case 'completeWithdrawals': {
      const r = await completeWithdrawals(call.args.withdrawalIds, call.args.depositId)
      return r.ok ? { ok: true } : r
    }
    case 'rejectWithdrawal': {
      const r = await rejectWithdrawal(call.args.withdrawalIds, call.args.depositId, call.args.reason)
      return r.ok ? { ok: true } : r
    }
    case 'extendDeposit': {
      const r = await extendDeposit(call.args.depositId, call.args.days)
      return r.ok ? { ok: true, note: r.data.expires_at.slice(0, 10) } : r
    }
    case 'setVip': {
      const r = await setVip(call.args.depositId, call.args.vip)
      return r.ok ? { ok: true } : r
    }
    case 'rejectDeposit': {
      const r = await rejectDeposit(call.args.depositId, call.args.reason)
      return r.ok ? { ok: true } : r
    }
    case 'createStaffBooking': {
      const r = await createStaffBooking(call.args)
      return r.ok ? { ok: true, note: r.data.code } : r
    }
    case 'confirmBooking': {
      const r = await confirmBooking(call.args.bookingId, call.args.tableId)
      return r.ok ? { ok: true } : r
    }
    case 'rejectBooking': {
      const r = await rejectBooking(call.args.bookingId, call.args.reason)
      return r.ok ? { ok: true } : r
    }
    case 'cancelBooking': {
      const r = await cancelBooking(call.args.bookingId, call.args.reason)
      return r.ok ? { ok: true } : r
    }
    case 'checkInBooking': {
      const r = await checkInBooking(call.args.branchId, call.args.ref)
      return r.ok ? { ok: true } : r
    }
    case 'openDepositForm':
      return { ok: true }
  }
}

/**
 * R-071 — a prepared action: what will happen, then ยืนยัน / ยกเลิก. Only the person's tap runs it;
 * afterwards the card says how it went and links to the record.
 */
export function AiProposalCard({ proposal, outcome, onOutcome, onNavigate }: { proposal: Proposal; outcome: CardOutcome; onOutcome: (o: CardOutcome) => void; onNavigate: () => void }) {
  const t = useTranslations('ai')
  const te = useTranslations('errors')
  const router = useRouter()
  const [pending, start] = useTransition()
  const settled = outcome.state !== 'pending'

  function confirm() {
    if (proposal.call.fn === 'openDepositForm') {
      onOutcome({ state: 'done' })
      onNavigate()
      router.push(proposal.call.args.href)
      return
    }
    onOutcome({ state: 'running' })
    start(async () => {
      try {
        const res = await execute(proposal.call)
        if (res.ok) {
          onOutcome({ state: 'done', note: res.note })
          router.refresh()
        } else onOutcome({ state: 'failed', error: res.error })
      } catch {
        onOutcome({ state: 'failed', error: 'unknown' })
      }
    })
  }

  const value = (key: string, v: string, tr?: boolean) => (tr && t.has(`value.${v}`) ? t(`value.${v}`) : v)
  const tone =
    outcome.state === 'done'
      ? 'border-status-done-ring bg-status-done-bg'
      : outcome.state === 'failed'
        ? 'border-urgent-ring bg-urgent-bg'
        : outcome.state === 'cancelled'
          ? 'border-dashed border-line opacity-60'
          : 'border-brand/40 bg-card'

  return (
    <div className={`mr-4 rounded-xl border p-3 ${tone}`} data-testid="ai-card" data-kind={proposal.kind} data-state={outcome.state}>
      <p className="mb-2 text-sm font-semibold text-ink">{t(`card.${proposal.kind}`)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {proposal.fields.map((f) => (
          <div key={f.key} className="contents">
            <dt className="text-muted-token">{t.has(`field.${f.key}`) ? t(`field.${f.key}`) : f.key}</dt>
            <dd className="min-w-0 break-words font-medium text-ink">{value(f.key, f.value, f.tr)}</dd>
          </div>
        ))}
      </dl>

      {outcome.state === 'pending' || outcome.state === 'running' ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" disabled={pending || outcome.state === 'running'} onClick={() => onOutcome({ state: 'cancelled' })} data-testid="ai-card-cancel">
            {t('cardCancel')}
          </button>
          <button type="button" className="btn-primary" disabled={pending || outcome.state === 'running'} onClick={confirm} data-testid="ai-card-confirm">
            {outcome.state === 'running' && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {proposal.call.fn === 'openDepositForm' ? t('cardOpenForm') : t('cardConfirm')}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="ai-card-result">
          <span className={`inline-flex items-center gap-1 font-semibold ${outcome.state === 'done' ? 'text-status-done' : outcome.state === 'failed' ? 'text-urgent' : 'text-muted-token'}`}>
            {outcome.state === 'done' ? <Check className="size-4" aria-hidden /> : outcome.state === 'failed' ? <CircleX className="size-4" aria-hidden /> : null}
            {outcome.state === 'done'
              ? outcome.note
                ? t('cardDoneNote', { note: outcome.note })
                : t(proposal.call.fn === 'openDepositForm' ? 'cardOpened' : 'cardDone')
              : outcome.state === 'failed'
                ? te(outcome.error ?? 'unknown')
                : t('cardCancelled')}
          </span>
          {settled && proposal.link && outcome.state !== 'cancelled' && (
            <Link href={proposal.link} onClick={onNavigate} className="inline-flex items-center gap-1 font-semibold text-brand">
              {t('cardOpen')}
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
