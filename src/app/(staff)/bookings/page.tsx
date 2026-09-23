import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState, Skeleton } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'
import { zonesWithTables, bookingSettingsRow } from '@/lib/booking/queries'
import { NightPicker } from '@/components/booking/night-picker'
import { ViewTabs } from '@/components/booking/view-tabs'
import { NewBookingButton } from '@/components/booking/new-booking-button'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { businessNight } from '@/lib/date'
import { BookingsContent } from './bookings-content'

const isNightParam = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

function PlanSkeleton() {
  return (
    <div className="card-surface flex flex-col gap-4 p-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <div className="tables-grid">
            {Array.from({ length: 6 }).map((_, j) => (
              <Skeleton key={j} className="h-18.5 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const t = await getTranslations('bookings')
  const tn = await getTranslations('nav')
  const state = await getActorState()
  if (state.status !== 'ok') return null
  const { actor } = state
  const branch = actor.branch

  if (!branch) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState message={tn('switchBranch')} />
      </>
    )
  }

  const nightParam = typeof sp.night === 'string' ? sp.night : undefined
  const night = nightParam && isNightParam(nightParam) ? nightParam : businessNight()
  const view = sp.view === 'list' ? 'list' : 'plan'
  const params = { night: nightParam, view: typeof sp.view === 'string' ? sp.view : undefined }

  const [{ zones, error: zError }, { settings, error: sError }] = await Promise.all([
    zonesWithTables(branch.id),
    bookingSettingsRow(branch.id),
  ])

  if (zError || sError || !settings) {
    return (
      <>
        <PageHeader title={t('title')} action={<NightPicker night={night} params={params} />} />
        <RefreshRetry />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        action={
          <>
            <NightPicker night={night} params={params} />
            <NewBookingButton branchId={branch.id} night={night} zones={zones} settings={settings} />
          </>
        }
      />
      <ViewTabs view={view} params={params} planLabel={t('viewPlan')} listLabel={t('viewList')} />
      <Suspense key={`${branch.id}:${night}:${view}`} fallback={view === 'plan' ? <PlanSkeleton /> : <div className="panel h-64 animate-pulse" />}>
        <BookingsContent branchId={branch.id} night={night} view={view} role={actor.role} locale={actor.locale} isOwner={actor.role === 'owner'} zones={zones} />
      </Suspense>
    </>
  )
}
