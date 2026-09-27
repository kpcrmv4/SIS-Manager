import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { BackLink } from '@/components/shell/back-link'
import { BottlesGrid } from '@/components/deposit/bottles-grid'
import { HistoryTimeline } from '@/components/deposit/history-timeline'
import { DetailActions } from '@/components/deposit/detail-actions'
import { CustomerCard, DetailSummary, FactsCard, PhotosCard } from '@/components/deposit/detail-cards'
import { getActorState } from '@/lib/auth/actor'
import { getDepositDetail } from '@/lib/deposit/detail'
import { getBranchSettings, DOW_NAMES } from '@/lib/deposit/branch'
import { depositBadgeSpec, badgeText } from '@/lib/deposit/format'
import { businessNight, weekdayIndex } from '@/lib/date'
import { signedPhotoUrls } from '@/lib/photos-server'
import { isUuid } from '@/lib/action'

/**
 * One deposit (R-045): the summary a glance needs, what to do next, then the bottles, the
 * customer, the facts and the photos; the history beside them on a wide screen, last on a phone.
 */
export default async function DepositDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const state = await getActorState()
  if (state.status !== 'ok') notFound()
  const { actor } = state
  if (!actor.branch) notFound()
  const branch = actor.branch

  const [detail, branchSettings] = await Promise.all([getDepositDetail(branch.id, id), getBranchSettings(branch.id)])
  if (!detail) notFound()

  const t = await getTranslations('deposit')
  const tRoot = await getTranslations()

  const photoUrls = await signedPhotoUrls([...detail.photoPaths, ...detail.confirmPhotoPaths])
  const spec = depositBadgeSpec(detail)
  const tonightDow = DOW_NAMES[weekdayIndex(businessNight())]
  const blockedTonight = branchSettings?.withdrawalBlockedDays.includes(tonightDow) ?? false
  const depositDays = branchSettings?.depositDays ?? 30

  return (
    <>
      <BackLink fallbackHref="/deposits" fallbackLabel={t('back')} />
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 wrap-break-word text-2xl font-bold leading-tight text-ink">{detail.itemName}</h1>
          <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-token">
          <span className="code">{detail.code}</span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{detail.customerName}</span>
        </div>
      </header>

      <div className="grid items-start gap-4 nav:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <DetailSummary detail={detail} noticeDays={branchSettings?.expiryNoticeDays ?? 7} locale={actor.locale} />
          <DetailActions deposit={detail} role={actor.role} branchId={branch.id} depositDays={depositDays} blockedTonight={blockedTonight} locale={actor.locale} />
          <BottlesGrid bottles={detail.bottles} total={detail.quantity} />
          <CustomerCard detail={detail} canEditReminders={actor.role === 'bar' || actor.role === 'owner'} branchRemindersOff={branchSettings?.expiryRemindersEnabled === false} locale={actor.locale} />
          <FactsCard detail={detail} depositDays={depositDays} locale={actor.locale} />
          <PhotosCard urls={Object.values(photoUrls)} />
        </div>
        <HistoryTimeline events={detail.events} locale={actor.locale} />
      </div>
    </>
  )
}
