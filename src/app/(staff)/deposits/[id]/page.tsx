import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { BottlesGrid } from '@/components/deposit/bottles-grid'
import { HistoryTimeline } from '@/components/deposit/history-timeline'
import { DetailActions } from '@/components/deposit/detail-actions'
import { PrintStatusBadge } from '@/components/print/print-status-badge'
import { getActorState } from '@/lib/auth/actor'
import { getDepositDetail } from '@/lib/deposit/detail'
import { getBranchSettings, DOW_NAMES } from '@/lib/deposit/branch'
import { depositBadgeSpec, badgeText } from '@/lib/deposit/format'
import { formatShortDate, formatTime, businessNight, weekdayIndex } from '@/lib/date'
import { signedPhotoUrls } from '@/lib/photos-server'
import { isUuid } from '@/lib/action'

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
      <Link href="/deposits" className="btn-ghost btn-sm mb-2">
        ‹ {t('back')}
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-ink">{detail.itemName}</h1>
          <div className="mt-0.5 text-sm text-muted-token">
            <span className="code">{detail.code}</span> · {detail.customerName}
          </div>
        </div>
        <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
      </div>

      <div className="grid gap-4 nav:grid-cols-2">
        <div className="flex flex-col gap-4">
          <BottlesGrid bottles={detail.bottles} total={detail.quantity} />

          <div className="card-surface p-4">
            <dl className="kv">
              <dt>{t('customer')}</dt>
              <dd>
                {detail.customerName}
                {detail.customerPhone && (
                  <>
                    {' · '}
                    <span className="num">{detail.customerPhone}</span>
                  </>
                )}
              </dd>
              <dt>{t('line')}</dt>
              <dd>
                <Badge tone={detail.customerId ? 'done' : 'pending'}>{detail.customerId ? t('lineLinked') : t('lineNotLinked')}</Badge>
              </dd>
              <dt>{t('depositedAt')}</dt>
              <dd className="num">
                {t('depositedAtValue', {
                  date: formatShortDate(detail.createdAt, actor.locale),
                  time: formatTime(detail.createdAt, actor.locale),
                  table: detail.tableLabel ?? '—',
                })}
              </dd>
              <dt>{t('expires')}</dt>
              <dd className="num">
                {detail.isVip || !detail.expiresAt
                  ? tRoot('deposits.noExpiry')
                  : t('expiresValue', { date: formatShortDate(detail.expiresAt, actor.locale), days: depositDays })}
              </dd>
              {detail.collectDeadlineAt && (
                <>
                  <dt>{t('collectUntil')}</dt>
                  <dd className="num">
                    {t('collectUntilValue', { date: formatShortDate(detail.collectDeadlineAt, actor.locale), time: formatTime(detail.collectDeadlineAt, actor.locale) })}
                  </dd>
                </>
              )}
              {detail.receivedByName && (
                <>
                  <dt>{t('receivedBy')}</dt>
                  <dd>
                    {detail.confirmedByName
                      ? t('receivedByValue', { received: detail.receivedByName, confirmed: detail.confirmedByName })
                      : t('receivedByOnly', { received: detail.receivedByName })}
                  </dd>
                </>
              )}
              {detail.notes && (
                <>
                  <dt>{t('notes')}</dt>
                  <dd>{detail.notes}</dd>
                </>
              )}
            </dl>
            {Object.keys(photoUrls).length > 0 && (
              <div className="mt-3.5">
                <div className="label-base">{t('photos')}</div>
                <div className="flex flex-wrap gap-2">
                  {Object.values(photoUrls).map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="" className="size-16 rounded-md border border-line object-cover" />
                  ))}
                </div>
              </div>
            )}
          </div>

          <DetailActions deposit={detail} role={actor.role} branchId={branch.id} depositDays={depositDays} blockedTonight={blockedTonight} locale={actor.locale} />
          <PrintStatusBadge branchId={branch.id} />
        </div>

        <HistoryTimeline events={detail.events} locale={actor.locale} />
      </div>
    </>
  )
}
