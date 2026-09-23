'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { DepositDetail } from '@/lib/deposit/detail'
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
 * Every button on the detail page, gated by role + current status — the DB enforces the
 * same rules (RPC role checks), this only decides what to SHOW. staff never sees
 * confirm/reject/extend/VIP/dispose; the note explains why (P2-A1-10).
 */
export function DetailActions({
  deposit,
  role,
  branchId,
  depositDays,
  blockedTonight,
  locale,
}: {
  deposit: DepositDetail
  role: 'staff' | 'bar' | 'owner'
  branchId: string
  depositDays: number
  blockedTonight: boolean
  locale: 'th' | 'en'
}) {
  const t = useTranslations('deposit')
  const [dialog, setDialog] = useState<DialogKind>(null)
  const barOrOwner = role !== 'staff'
  const { status, isVip } = deposit

  const canWithdraw = status === 'in_store' || status === 'pending_withdrawal'
  const searchParams = useSearchParams()

  // Deep link from the scan result card's "withdraw" button (/deposits/[id]?open=withdraw).
  useEffect(() => {
    if (canWithdraw && searchParams.get('open') === 'withdraw') setDialog('withdraw')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const canPrint = status !== 'requested' && status !== 'cancelled'
  const canReceive = status === 'requested'
  const canConfirm = barOrOwner && status === 'pending_confirm'
  const canReject = barOrOwner && (status === 'requested' || status === 'pending_confirm')
  const canExtend = barOrOwner && !isVip && (status === 'in_store' || status === 'pending_withdrawal')
  const canVip = barOrOwner && (status === 'pending_confirm' || status === 'in_store' || status === 'pending_withdrawal')

  return (
    <div className="flex flex-col gap-3">
      <div className="actions flex flex-wrap gap-2">
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
        {canWithdraw && (
          <button type="button" className="btn-primary" onClick={() => setDialog('withdraw')} data-testid="action-withdraw">
            {t('actionWithdraw')}
          </button>
        )}
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

      {role === 'staff' && (
        <p className="note" data-testid="bar-only-note">
          {t('barOnlyNote')}
        </p>
      )}

      {barOrOwner && <WithdrawalPanel depositId={deposit.id} pending={deposit.pendingWithdrawals} />}

      {canReceive && <ReceiveDialog open={dialog === 'receive'} onOpenChange={(v) => setDialog(v ? 'receive' : null)} depositId={deposit.id} branchId={branchId} defaultQuantity={deposit.quantity} />}
      {canConfirm && <ConfirmDialog open={dialog === 'confirm'} onOpenChange={(v) => setDialog(v ? 'confirm' : null)} depositId={deposit.id} branchId={branchId} quantity={deposit.quantity} />}
      {canReject && <RejectDialog open={dialog === 'reject'} onOpenChange={(v) => setDialog(v ? 'reject' : null)} depositId={deposit.id} />}
      {canWithdraw && (
        <WithdrawDialog
          open={dialog === 'withdraw'}
          onOpenChange={(v) => setDialog(v ? 'withdraw' : null)}
          depositId={deposit.id}
          bottles={deposit.bottles}
          pendingBottleIds={new Set(deposit.pendingWithdrawals.map((w) => w.bottleId).filter((id): id is string => !!id))}
          defaultTable={deposit.tableLabel ?? ''}
          blockedTonight={blockedTonight}
        />
      )}
      {canExtend && <ExtendDialog open={dialog === 'extend'} onOpenChange={(v) => setDialog(v ? 'extend' : null)} depositId={deposit.id} defaultDays={depositDays} locale={locale} />}
      {canVip && <VipDialog open={dialog === 'vip'} onOpenChange={(v) => setDialog(v ? 'vip' : null)} depositId={deposit.id} isVip={isVip} depositDays={depositDays} />}
    </div>
  )
}
