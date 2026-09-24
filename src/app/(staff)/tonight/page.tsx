import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { MetricBar, Metric } from '@/components/ui/metric'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { getActorState, isBarOrOwner } from '@/lib/auth/actor'
import { getBranchSettings } from '@/lib/deposit/branch'
import { getTonightData, type TonightBooking, type PendingTask } from '@/lib/deposit/tonight'
import { depositBadgeSpec, badgeText } from '@/lib/deposit/format'
import { formatLongDate, formatShortDate, formatTime } from '@/lib/date'
import { CheckInButton } from './check-in-button'

function taskHref(task: PendingTask) {
  return `/deposits/${task.depositId}`
}

export default async function TonightPage() {
  const t = await getTranslations('tonight')
  const tn = await getTranslations('nav')
  const tRoot = await getTranslations()
  const ts = await getTranslations('status')
  const state = await getActorState()
  const actor = state.status === 'ok' ? state.actor : null
  const branch = actor?.branch ?? null

  if (!actor || !branch) {
    return (
      <>
        <PageHeader title={tn('tonight')} />
        <EmptyState message={tn('switchBranch')} />
      </>
    )
  }

  const settings = await getBranchSettings(branch.id)
  const expiryNoticeDays = settings?.expiryNoticeDays ?? 7
  const data = await getTonightData(branch.id, expiryNoticeDays)
  const barOrOwner = isBarOrOwner(actor.role)

  const opens = settings?.opensAt?.slice(0, 5) ?? ''
  const closes = settings?.closesAt?.slice(0, 5) ?? ''

  return (
    <>
      <PageHeader
        title={t('title', { branch: branch.name })}
        subtitle={t('subtitle', { date: formatLongDate(new Date(), actor.locale), open: opens, close: closes })}
      />

      <MetricBar>
        <Metric label={t('kpiBookings')} value={data.bookings.length} hint={t('kpiBookingsHint', { people: data.bookingPeople, arrived: data.bookingArrived })} href="/bookings" />
        {barOrOwner && <Metric label={t('kpiToConfirm')} value={data.toConfirmCount} hint={t('kpiToConfirmHint')} tone="progress" href="/deposits?tab=toConfirm" />}
        <Metric label={t('kpiWithdrawals')} value={data.withdrawCount} hint={t('kpiWithdrawalsHint')} tone="violet" href="/deposits?tab=withdraw" />
        <Metric
          label={t('kpiExpiring', { days: expiryNoticeDays })}
          value={data.expiring.length}
          hint={t('kpiExpiringHint', { count: data.expiringNotifiedCount })}
          tone="urgent"
          href="/deposits?tab=inStore"
        />
      </MetricBar>

      {/* grid-cols-1 = minmax(0,1fr): a long nowrap row must truncate, not widen the page past a phone */}
      <div className="grid grid-cols-1 gap-6 nav:grid-cols-2">
        <div>
          <h2 className="sec-head">
            <span>{t('bookingsTonight')}</span>
            <Link href="/bookings" className="more">
              {t('viewPlan')}
            </Link>
          </h2>
          {data.bookings.length === 0 ? (
            <EmptyState message={t('noBookings')} />
          ) : (
            <div className="panel">
              {data.bookings.map((b) => (
                <BookingRow key={b.id} booking={b} branchId={branch.id} ts={ts} tRoot={tRoot} />
              ))}
            </div>
          )}

          <h2 className="sec-head">{t('pendingWork')}</h2>
          {data.pendingWork.length === 0 ? (
            <EmptyState message={t('noWork')} />
          ) : (
            <div className="panel">
              {data.pendingWork.map((task) => (
                <TaskRow key={`${task.kind}-${task.depositId}`} task={task} t={t} ts={ts} />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="sec-head">{t('expiringSoon')}</h2>
          {data.expiring.length === 0 ? (
            <EmptyState message={t('noExpiring')} />
          ) : (
            <div className="panel">
              {data.expiring.map((e) => {
                const spec = depositBadgeSpec({ status: 'in_store', isVip: false, expiresAt: e.expiresAt })
                return (
                  <Link
                    key={e.id}
                    href={`/deposits/${e.id}`}
                    className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 transition-colors duration-100 last:border-b-0 hover:bg-surface-2 md:px-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold leading-6 text-ink">
                        {e.itemName} · {e.customerName}
                      </div>
                      <div className="truncate text-sm leading-5 text-muted-token">
                        {t('expiringMeta', { date: formatShortDate(e.expiresAt, actor.locale), left: tRoot('deposits.remaining', { count: e.remainingQty, percent: Math.round(e.remainingPercent) }) })}
                      </div>
                    </div>
                    <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function BookingRow({
  booking,
  branchId,
  ts,
  tRoot,
}: {
  booking: TonightBooking
  branchId: string
  ts: Awaited<ReturnType<typeof getTranslations>>
  tRoot: Awaited<ReturnType<typeof getTranslations>>
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 md:px-4" data-testid="tonight-booking-row">
      <span className="w-12 shrink-0 tnum text-sm text-muted-token">{booking.slotTime.slice(0, 5)}</span>
      {booking.tableLabel ? (
        <span className="w-9 shrink-0 rounded-sm bg-surface-2 px-1.5 py-1 text-center text-xs font-semibold text-ink-2">{booking.tableLabel}</span>
      ) : (
        <span className="w-14 shrink-0 rounded-sm bg-surface-2 px-1 py-1 text-center text-[11px] leading-tight font-medium text-muted-token">{tRoot('bookings.unassigned')}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-6 text-ink">
          {booking.name} · {tRoot('common.people', { count: booking.partySize })}
        </div>
        <div className="truncate text-sm leading-5 text-muted-token">{booking.code}</div>
      </div>
      {booking.status === 'confirmed' && <CheckInButton branchId={branchId} bookingId={booking.id} code={booking.code} />}
      {booking.status === 'arrived' && <Badge tone="done">{ts('booking.arrived')}</Badge>}
      {booking.status === 'pending' && <Badge tone="progress">{ts('booking.pending')}</Badge>}
      {booking.status === 'no_show' && <Badge tone="urgent">{ts('booking.no_show')}</Badge>}
      {(booking.status === 'cancelled' || booking.status === 'rejected') && <Badge tone="pending">{ts(`booking.${booking.status}`)}</Badge>}
    </div>
  )
}

function TaskRow({ task, t, ts }: { task: PendingTask; t: Awaited<ReturnType<typeof getTranslations>>; ts: Awaited<ReturnType<typeof getTranslations>> }) {
  const table = task.tableLabel ?? '—'
  if (task.kind === 'confirm') {
    return (
      <Link href={taskHref(task)} className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 transition-colors duration-100 last:border-b-0 hover:bg-surface-2 md:px-4" data-testid="tonight-task-confirm">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold leading-6 text-ink">{t('taskConfirm', { item: task.itemName })}</div>
          <div className="truncate text-sm leading-5 text-muted-token">{t('taskConfirmMeta', { customer: task.customerName, table, time: task.receivedAt ? formatTime(task.receivedAt) : '' })}</div>
        </div>
        <Badge tone="progress">{ts('deposit.pending_confirm')}</Badge>
      </Link>
    )
  }
  if (task.kind === 'withdraw') {
    return (
      <Link href={taskHref(task)} className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 transition-colors duration-100 last:border-b-0 hover:bg-surface-2 md:px-4" data-testid="tonight-task-withdraw">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold leading-6 text-ink">{t('taskWithdraw', { item: task.itemName, count: task.count })}</div>
          <div className="truncate text-sm leading-5 text-muted-token">{t('taskWithdrawMeta', { customer: task.customerName, table, time: formatTime(task.createdAt) })}</div>
        </div>
        <Badge tone="violet">{ts('deposit.pending_withdrawal')}</Badge>
      </Link>
    )
  }
  return (
    <Link href={taskHref(task)} className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 transition-colors duration-100 last:border-b-0 hover:bg-surface-2 md:px-4" data-testid="tonight-task-request">
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-6 text-ink">{t('taskRequest', { customer: task.customerName })}</div>
        <div className="truncate text-sm leading-5 text-muted-token">{t('taskRequestMeta', { table })}</div>
      </div>
      <Badge tone="info">{ts('deposit.requested')}</Badge>
    </Link>
  )
}
