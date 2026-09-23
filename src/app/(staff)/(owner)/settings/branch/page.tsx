import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseServer } from '@/lib/supabase/server'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { BranchForm, type BranchFormValue } from '@/components/settings/branch-form'

// Built in P2-B3.
export default async function SettingsBranchPage() {
  const t = await getTranslations('settingsBranch')
  const tn = await getTranslations('nav')
  const state = await getActorState()
  if (state.status !== 'ok') return null
  const branch = state.actor.branch
  if (!branch) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState message={tn('switchBranch')} />
      </>
    )
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('branches')
    .select('name, active, opens_at, closes_at, deposit_days, expiry_notice_days, withdrawal_blocked_days, receipt_settings')
    .eq('id', branch.id)
    .maybeSingle()

  if (error || !data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <RefreshRetry />
      </>
    )
  }

  const receipt = (data.receipt_settings ?? {}) as { header?: string; footer?: string; copies?: number }
  const initial: BranchFormValue = {
    name: data.name,
    active: data.active,
    opensAt: data.opens_at,
    closesAt: data.closes_at,
    depositDays: data.deposit_days,
    expiryNoticeDays: data.expiry_notice_days,
    withdrawalBlockedDays: data.withdrawal_blocked_days,
    receiptHeader: receipt.header ?? '',
    receiptFooter: receipt.footer ?? '',
    receiptCopies: receipt.copies ?? 1,
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={branch.name} />
      <BranchForm branchId={branch.id} initial={initial} />
    </>
  )
}
