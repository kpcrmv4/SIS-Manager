import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'
import { ScanPanel } from './scan-panel'

export default async function ScanPage() {
  const t = await getTranslations('scan')
  const tn = await getTranslations('nav')
  const state = await getActorState()
  const branch = state.status === 'ok' ? state.actor.branch : null
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {branch ? <ScanPanel branchId={branch.id} /> : <EmptyState message={tn('switchBranch')} />}
    </>
  )
}
