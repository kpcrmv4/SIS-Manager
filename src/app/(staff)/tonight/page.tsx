import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'

// Built in P2-A3 (tonight + deposit scan).
export default async function TonightPage() {
  const t = await getTranslations('tonight')
  const tn = await getTranslations('nav')
  const state = await getActorState()
  const branch = state.status === 'ok' ? state.actor.branch?.name : undefined
  return (
    <>
      <PageHeader title={branch ? t('title', { branch }) : tn('tonight')} />
      <EmptyState message={t('noBookings')} />
    </>
  )
}
