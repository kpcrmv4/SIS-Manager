'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowUpFromLine, CalendarX, CheckCheck, CircleX, ClipboardCheck, Inbox, Plus, Trash2, Wine, type LucideIcon } from 'lucide-react'
import type { DepositDetail } from '@/lib/deposit/detail'
import type { DepositStatus } from '@/lib/deposit/format'
import type { LiquorItem } from '@/lib/deposit/items'
import { PrintStatusBadge } from '@/components/print/print-status-badge'
import { ConfirmDialog } from './confirm-dialog'
import { RejectDialog } from './reject-dialog'
import { WithdrawDialog } from './withdraw-dialog'
import { ExtendDialog } from './extend-dialog'
import { VipDialog } from './vip-dialog'
import { ReceiveDialog } from './receive-dialog'
import { PrintButtons } from './print-buttons'
import { WithdrawalPanel } from './withdrawal-panel'

type DialogKind = 'confirm' | 'reject' | 'withdraw' | 'extend' | 'vip' | 'receive' | null

/**
 * What the deposit's state means for whoever is looking (R-045): an icon and its tone — the same hue
 * as the state's filter card and badge on /deposits (R-047).
 */
const STATE: Record<DepositStatus, { icon: LucideIcon; tone: string }> = {
  requested: { icon: Inbox, tone: 'bg-status-info-bg text-status-info' },
  pending_confirm: { icon: ClipboardCheck, tone: 'bg-status-progress-bg text-status-progress' },
  in_store: { icon: Wine, tone: 'bg-status-done-bg text-status-done' },
  pending_withdrawal: { icon: ArrowUpFromLine, tone: 'bg-status-violet-bg text-status-violet' },
  expired: { icon: CalendarX, tone: 'bg-urgent-bg text-urgent' },
  withdrawn: { icon: CheckCheck, tone: 'bg-surface-2 text-muted-token' },
  disposed: { icon: Trash2, tone: 'bg-surface-2 text-muted-token' },
  cancelled: { icon: CircleX, tone: 'bg-surface-2 text-muted-token' },
}

/**
 * The deposit page's "what now" card: the state in words, the one or two things to do next,
 * then the tools (print, extend, VIP) with the printer's status. Every button is gated by
 * role + status — the DB enforces the same rules (RPC role checks), this only decides what to
 * SHOW. staff never see confirm/reject/extend/VIP; the note says why (P2-A1-10).
 */
export function DetailActions({
  deposit,
  role,
  branchId,
  depositDays,
  blockedTonight,
  locale,
  items = [],
}: {
  deposit: DepositDetail
  /** bar / owner confirming: the branch's liquor list (R-060) */
  items?: LiquorItem[]
  role: 'staff' | 'bar' | 'owner'
  branchId: string
  depositDays: number
  blockedTonight: boolean
  locale: 'th' | 'en'
}) {
  const t = useTranslations('deposit')
  const barOrOwner = role !== 'staff'
  const { status, isVip } = deposit

  // a request already waiting: its panel leads, and asking for another bottle becomes a
  // secondary "เบิกขวดอื่นเพิ่ม" — gone when every bottle left is already asked for
  const waiting = deposit.pendingWithdrawals
  const pendingBottleIds = new Set(waiting.map((w) => w.bottleId).filter((id): id is string => !!id))
  const freeBottles = deposit.bottles.filter((b) => b.status !== 'consumed' && !pendingBottleIds.has(b.id)).length
  const canWithdraw = (status === 'in_store' || status === 'pending_withdrawal') && freeBottles > 0
  const searchParams = useSearchParams()
  // the scan result card's "withdraw" button deep-links here with ?open=withdraw
  const [dialog, setDialog] = useState<DialogKind>(() => (canWithdraw && searchParams.get('open') === 'withdraw' ? 'withdraw' : null))
  const canPrint = status !== 'requested' && status !== 'cancelled'
  const canReceive = status === 'requested'
  const canConfirm = barOrOwner && status === 'pending_confirm'
  const canReject = barOrOwner && (status === 'requested' || status === 'pending_confirm')
  const canExtend = barOrOwner && !isVip && (status === 'in_store' || status === 'pending_withdrawal')
  const canVip = barOrOwner && (status === 'pending_confirm' || status === 'in_store' || status === 'pending_withdrawal')
  const toExpiredTab = barOrOwner && status === 'expired'

  const hint =
    status === 'disposed' && deposit.disposeReason
      ? t('nextHint.reason', { reason: deposit.disposeReason })
      : status === 'cancelled' && deposit.cancelReason
        ? t('nextHint.reason', { reason: deposit.cancelReason })
        : status === 'requested' || status === 'in_store' || status === 'withdrawn'
          ? t(`nextHint.${status}`)
          : status === 'pending_confirm' || status === 'pending_withdrawal' || status === 'expired'
            ? t(barOrOwner ? `nextHint.${status}` : `nextHint.${status}_staff`)
            : null
  const withdrawMore = canWithdraw && waiting.length > 0
  const primary = [canReceive, canConfirm, canReject, canWithdraw && !withdrawMore, toExpiredTab].filter(Boolean).length
  const { icon: Icon, tone } = STATE[status]

  return (
    <section className="card-surface flex flex-col gap-3 p-4" data-testid="deposit-next" data-status={status}>
      <div className="flex items-start gap-3">
        <span className={`grid size-10 flex-none place-items-center rounded-full ${tone}`} aria-hidden>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-[15px] font-semibold leading-snug text-ink">{t(`next.${status}`)}</h2>
          {hint && <p className="mt-0.5 text-sm text-muted-token">{hint}</p>}
        </div>
      </div>

      {primary > 0 && (
        <div className={`grid gap-2 ${primary > 1 ? 'grid-cols-2' : 'grid-cols-1'} sm:flex sm:flex-wrap`}>
          {canReceive && (
            <button type="button" className="btn-primary" onClick={() => setDialog('receive')} data-testid="action-receive">
              {t('actionReceive')}
            </button>
          )}
          {canConfirm && (
            <button type="button" className="btn-primary" onClick={() => setDialog('confirm')} data-testid="action-confirm">
              {t('actionConfirm')}
            </button>
          )}
          {canReject && (
            <button type="button" className="btn-danger" onClick={() => setDialog('reject')} data-testid="action-reject">
              {t('actionReject')}
            </button>
          )}
          {canWithdraw && !withdrawMore && (
            <button type="button" className="btn-primary" onClick={() => setDialog('withdraw')} data-testid="action-withdraw">
              {t('actionWithdraw')}
            </button>
          )}
          {toExpiredTab && (
            <Link href="/deposits?tab=expired" className="btn-secondary" data-testid="action-go-expired">
              {t('goExpired')}
            </Link>
          )}
        </div>
      )}

      <WithdrawalPanel depositId={deposit.id} pending={waiting} canDecide={barOrOwner} />
      {/* a new request is its own section under the waiting one — never mistaken for it (owner, 2026-09-28) */}
      {withdrawMore && (
        <div className="rounded-lg border border-dashed border-line-strong p-3" data-testid="withdraw-new-section">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{t('withdrawNewTitle')}</span>
            <span className="text-xs text-muted-token tnum">{t('withdrawNewLeft', { count: freeBottles })}</span>
          </div>
          <button type="button" className="btn-secondary w-full" onClick={() => setDialog('withdraw')} data-testid="action-withdraw" data-more="true">
            <Plus className="size-4" aria-hidden />
            {t('actionWithdrawMore')}
          </button>
        </div>
      )}

      {(canPrint || canExtend || canVip) && (
        <div className="border-t border-line-soft pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-token">{t('tools')}</span>
            {canPrint && <PrintStatusBadge branchId={branchId} />}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {canPrint && <PrintButtons depositId={deposit.id} branchId={branchId} code={deposit.code} />}
            {canExtend && (
              <button type="button" className="btn-secondary" onClick={() => setDialog('extend')} data-testid="action-extend">
                {t('actionExtend')}
              </button>
            )}
            {canVip && (
              <button type="button" className="btn-secondary" onClick={() => setDialog('vip')} data-testid="action-vip">
                {isVip ? t('actionUnvip') : t('actionVip')}
              </button>
            )}
          </div>
        </div>
      )}

      {role === 'staff' && (
        <p className="note" data-testid="bar-only-note">
          {t('barOnlyNote')}
        </p>
      )}

      {canReceive && <ReceiveDialog open={dialog === 'receive'} onOpenChange={(v) => setDialog(v ? 'receive' : null)} depositId={deposit.id} branchId={branchId} defaultQuantity={deposit.quantity} />}
      {canConfirm && (
        <ConfirmDialog
          open={dialog === 'confirm'}
          onOpenChange={(v) => setDialog(v ? 'confirm' : null)}
          depositId={deposit.id}
          branchId={branchId}
          quantity={deposit.quantity}
          items={items}
          itemId={deposit.itemId}
          itemName={deposit.itemName}
        />
      )}
      {canReject && <RejectDialog open={dialog === 'reject'} onOpenChange={(v) => setDialog(v ? 'reject' : null)} depositId={deposit.id} />}
      {canWithdraw && (
        <WithdrawDialog
          open={dialog === 'withdraw'}
          onOpenChange={(v) => setDialog(v ? 'withdraw' : null)}
          depositId={deposit.id}
          bottles={deposit.bottles}
          pendingBottleIds={pendingBottleIds}
          pendingBottleNos={waiting.map((w) => w.bottleNo).filter((n): n is number => n !== null)}
          defaultTable={deposit.tableLabel ?? ''}
          blockedTonight={blockedTonight}
        />
      )}
      {canExtend && <ExtendDialog open={dialog === 'extend'} onOpenChange={(v) => setDialog(v ? 'extend' : null)} depositId={deposit.id} defaultDays={depositDays} locale={locale} />}
      {canVip && <VipDialog open={dialog === 'vip'} onOpenChange={(v) => setDialog(v ? 'vip' : null)} depositId={deposit.id} isVip={isVip} depositDays={depositDays} />}
    </section>
  )
}
