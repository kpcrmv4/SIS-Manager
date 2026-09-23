import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'

// Built in P2-A3 (tonight + deposit scan).
export default async function TonightPage() {
  const t = await getTranslations('tonight')
  const state = await getActorState()
  const branch = state.status === 'ok' ? state.actor.branch?.name ?? '' : ''
  return (
    <>
      <PageHeader title={t('title', { branch })} />
      <EmptyState message={t('noBookings')} />
    </>
  )
}
