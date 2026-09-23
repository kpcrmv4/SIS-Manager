import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/ui/states'
import { PageHeader } from './page-header'

/**
 * P1-05 route skeleton: title + empty state, both from the catalog. Each P2/P4 task
 * replaces the page body; the route, its role gate and its copy keys already exist.
 */
export async function PlaceholderPage({ title, empty }: { title: string; empty: string }) {
  const t = await getTranslations()
  return (
    <>
      <PageHeader title={t(title)} />
      <EmptyState message={t(empty)} />
    </>
  )
}
