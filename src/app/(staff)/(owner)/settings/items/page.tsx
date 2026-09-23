import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { getSupabaseServer } from '@/lib/supabase/server'
import { ItemsPageClient, type ItemRow } from '@/components/settings/items-page-client'

// Built in P2-B3.
export default async function SettingsItemsPage() {
  const t = await getTranslations('settingsItems')
  const sb = await getSupabaseServer()
  const [{ data: items, error: iError }, { data: branches, error: bError }] = await Promise.all([
    sb.from('liquor_items').select('id, name, category, branch_id, active, sort').order('sort').range(0, 999),
    sb.from('branches').select('id, name').order('sort').range(0, 199),
  ])

  if (iError || bError) {
    return (
      <>
        <PageHeader title={t('title')} />
        <RefreshRetry />
      </>
    )
  }

  const rows: ItemRow[] = (items ?? []).map((i) => ({ id: i.id, name: i.name, category: i.category, branchId: i.branch_id, active: i.active, sort: i.sort }))

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ItemsPageClient branches={branches ?? []} items={rows} />
    </>
  )
}
