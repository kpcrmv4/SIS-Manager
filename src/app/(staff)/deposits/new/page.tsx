import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { NewDepositForm } from '@/components/deposit/new-deposit-form'
import { getActorState } from '@/lib/auth/actor'
import { getBranchSettings } from '@/lib/deposit/branch'
import { listLiquorItems } from '@/lib/deposit/items'

export default async function NewDepositPage() {
  const t = await getTranslations('depositForm')
  const state = await getActorState()

  const actor = state.status === 'ok' ? state.actor : null
  const branch = actor?.branch ?? null

  if (!actor || !branch) {
    const tn = await getTranslations('nav')
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState message={tn('switchBranch')} />
      </>
    )
  }

  const [settings, items] = await Promise.all([getBranchSettings(branch.id), listLiquorItems(branch.id)])

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <NewDepositForm branchId={branch.id} items={items} depositDays={settings?.depositDays ?? 30} role={actor.role} locale={actor.locale} />
    </>
  )
}
