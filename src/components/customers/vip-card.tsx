'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Crown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from '@/components/deposit/action-dialog'
import { setCustomerVip } from '@/lib/customers/actions'

/**
 * ลูกค้า VIP (R-048): the state for everyone; for bar and owner the one button that changes it,
 * behind a confirm that names what will happen to the bottles. A customer known only by name
 * can't be VIP as a person — nothing would recognise their next deposit.
 */
export function VipCard({
  branchId,
  customerKey,
  isVip,
  since,
  by,
  canVip,
  canEdit,
  toVip,
  vipDeposits,
  depositDays,
}: {
  branchId: string
  customerKey: string
  isVip: boolean
  /** already formatted for the reader's locale */
  since: string | null
  by: string | null
  canVip: boolean
  canEdit: boolean
  toVip: number
  vipDeposits: number
  depositDays: number
}) {
  const t = useTranslations('customers')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await setCustomerVip(branchId, customerKey, !isVip)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(isVip ? t('vipCancelled', { count: res.data.deposits }) : t('vipMade', { count: res.data.deposits }))
      setOpen(false)
    })
  }

  return (
    <section className="card-surface p-4" data-testid="customer-vip" data-vip={isVip ? 'on' : 'off'}>
      <h2 className="sec-head">{t('vipTitle')}</h2>
      <div className="flex items-start gap-3">
        <span
          className={`grid size-10 flex-none place-items-center rounded-xl ${isVip ? 'bg-gold-bg text-gold-ink' : 'bg-surface-2 text-muted-token'}`}
          aria-hidden
        >
          <Crown className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink">{isVip ? t('vipOn') : t('vipOff')}</div>
          <p className="mt-0.5 text-sm text-muted-token">
            {isVip
              ? since
                ? by
                  ? t('vipOnSinceBy', { date: since, name: by })
                  : t('vipOnSince', { date: since })
                : t('vipOnBody')
              : t('vipOffBody', { days: depositDays })}
          </p>
        </div>
      </div>

      {canEdit ? (
        canVip ? (
          <button
            type="button"
            className={`${isVip ? 'btn-secondary' : 'btn-primary'} mt-3 w-full justify-center`}
            onClick={() => setOpen(true)}
            data-testid={isVip ? 'customer-vip-cancel' : 'customer-vip-make'}
          >
            <Crown className="size-4" aria-hidden />
            {isVip ? t('vipCancel') : t('vipMake')}
          </button>
        ) : (
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted-token" data-testid="customer-vip-needs-key">
            {t('vipNeedsKey')}
          </p>
        )
      ) : (
        <p className="mt-3 text-xs text-muted-token" data-testid="customer-vip-note">
          {t('vipBarOnly')}
        </p>
      )}

      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title={isVip ? t('vipCancelTitle') : t('vipMakeTitle')}
        description={isVip ? t('vipCancelBody', { count: vipDeposits, days: depositDays }) : t('vipMakeBody', { count: toVip })}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
              {tc('cancel')}
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={pending} data-testid="customer-vip-submit">
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {tc('confirm')}
            </button>
          </>
        }
      />
    </section>
  )
}
