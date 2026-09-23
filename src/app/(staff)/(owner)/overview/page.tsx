import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'

// Built in P4-01 (owner overview + reports).
export default async function OverviewPage() {
  const t = await getTranslations('overview')
  return (
    <>
      <PageHeader title={t('title')} />
      <EmptyState message={t('noDisposals')} />
    </>
  )
}
