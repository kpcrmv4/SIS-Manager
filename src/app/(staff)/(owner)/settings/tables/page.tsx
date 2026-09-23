import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseServer } from '@/lib/supabase/server'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { TablesPageClient, type ZoneWithTables } from '@/components/settings/tables-page-client'

// Built in P2-B3.
export default async function SettingsTablesPage() {
  const t = await getTranslations('settingsTables')
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
  const [{ data: zoneRows, error: zError }, { data: tableRows, error: tError }] = await Promise.all([
    sb.from('table_zones').select('id, name, sort, customer_bookable, active').eq('branch_id', branch.id).order('sort').range(0, 199),
    sb.from('tables').select('id, zone_id, label, shape, seats_min, seats_max, sort, active').eq('branch_id', branch.id).order('sort').range(0, 999),
  ])

  if (zError || tError) {
    return (
      <>
        <PageHeader title={t('title')} />
        <RefreshRetry />
      </>
    )
  }

  const byZone = new Map<string, ZoneWithTables['tables']>()
  for (const r of tableRows ?? []) {
    const list = byZone.get(r.zone_id) ?? []
    list.push({ id: r.id, label: r.label, shape: r.shape as ZoneWithTables['tables'][number]['shape'], seatsMin: r.seats_min, seatsMax: r.seats_max, sort: r.sort, active: r.active })
    byZone.set(r.zone_id, list)
  }
  const zones: ZoneWithTables[] = (zoneRows ?? []).map((z) => ({
    id: z.id,
    name: z.name,
    sort: z.sort,
    customerBookable: z.customer_bookable,
    active: z.active,
    tables: byZone.get(z.id) ?? [],
  }))
  const tableCount = (tableRows ?? []).length

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle', { branch: branch.name, zones: zones.length, tables: tableCount })} />
      <TablesPageClient branchId={branch.id} zones={zones} />
    </>
  )
}
