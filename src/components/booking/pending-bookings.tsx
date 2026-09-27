'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { replaceQuery, uuidParam } from '@/lib/url-state'
import { CalendarClock } from 'lucide-react'
import { ListRow } from '@/components/ui/list-row'
import type { NightBooking, ZoneRow } from '@/lib/booking/queries'
import { addDays, formatLongDate, formatTime, type AppLocale } from '@/lib/date'
import { BookingDetailDialog } from './booking-detail-dialog'
import { ConfirmAssignDialog } from './confirm-assign-dialog'
import { RejectDialog } from './reject-dialog'

/**
 * รอยืนยัน — every booking still waiting for the shop, tonight and later, grouped by night and
 * shown on /bookings whichever night is picked (owner request 2026-09-24: "if I don't pick the
 * date I never see them"). A row opens the booking sheet (loaded by id, any night); bar and
 * owner confirm + seat or reject right on the row, as in the list view.
 */
export function PendingBookings({
  bookings,
  tonight,
  locale,
  branchId,
  zones,
  isBarOrOwner,
}: {
  bookings: NightBooking[]
  tonight: string
  locale: AppLocale
  branchId: string
  zones: ZoneRow[]
  isBarOrOwner: boolean
}) {
  const t = useTranslations('bookings')
  const tc = useTranslations('common')
  const router = useRouter()
  const sp = useSearchParams()
  // the open booking stays in the address (?pb=, R-050): Back from its customer page reopens it
  const [detailId, setDetail] = useState<string | null>(() => uuidParam(sp.get('pb')))
  const setDetailId = (id: string | null) => {
    setDetail(id)
    replaceQuery({ pb: id })
  }
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const onDone = () => router.refresh()

  // nothing waiting: nothing to show — the section appears only when there is something to confirm
  if (bookings.length === 0) return null

  // the query orders by night then slot — keep that order, one group per night
  const groups: [string, NightBooking[]][] = []
  for (const b of bookings) {
    const last = groups.at(-1)
    if (last && last[0] === b.night) last[1].push(b)
    else groups.push([b.night, [b]])
  }
  const nightName = (night: string) => (night === tonight ? t('pendingTonight') : night === addDays(tonight, 1) ? t('pendingTomorrow') : null)

  const confirmTarget = bookings.find((b) => b.id === confirmId)
  const allTables = zones.flatMap((z) => z.tables)
  const tablesForConfirm = confirmTarget?.zoneId ? (zones.find((z) => z.id === confirmTarget.zoneId)?.tables ?? allTables) : allTables

  return (
    <section aria-label={t('pendingTitle')} className="mb-5" data-testid="pending-bookings">
      <h2 className="sec-head mt-0">
        <CalendarClock className="size-4 text-status-progress" aria-hidden />
        {t('pendingTitle')}
        <span className="count tnum">{t('pendingCount', { count: bookings.length })}</span>
      </h2>
      <div className="panel">
        {groups.map(([night, rows]) => {
          const name = nightName(night)
          const date = formatLongDate(`${night}T00:00:00Z`, locale)
          return (
            <div key={night} data-testid="pending-night" data-night={night}>
              <div className="panel-head">
                <span className="min-w-0 truncate">{name ? `${name} · ${date}` : date}</span>
                <span className="ml-auto shrink-0 text-xs font-medium text-muted-token tnum">{tc('tables', { count: rows.length })}</span>
              </div>
              {rows.map((b) => {
                const source = b.source === 'line' ? t('sourceLineAt', { time: formatTime(b.createdAt, locale) }) : t('sourceStaff')
                const meta = (
                  <span className="tnum">
                    {b.slotTime.slice(0, 5)}
                    {b.zoneName && ` · ${b.zoneName}`}
                    {b.tableLabel && ` · ${t('tableShort', { table: b.tableLabel })}`} · <span className="code">{b.code}</span> · {source}
                  </span>
                )
                const aside = isBarOrOwner ? (
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRejectId(b.id)
                      }}
                    >
                      {tc('reject')}
                    </button>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmId(b.id)
                      }}
                    >
                      {t('confirmAssign')}
                    </button>
                  </span>
                ) : undefined
                return (
                  <div
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    data-testid="pending-row"
                    data-code={b.code}
                    onClick={() => setDetailId(b.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setDetailId(b.id)
                      }
                    }}
                  >
                    <ListRow title={`${b.name} · ${tc('people', { count: b.party })}`} meta={meta} aside={aside} chevron={!isBarOrOwner} />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {detailId && <BookingDetailDialog bookingId={detailId} branchId={branchId} locale={locale} onOpenChange={(v) => !v && setDetailId(null)} onChanged={onDone} />}
      {confirmId && (
        <ConfirmAssignDialog
          open={Boolean(confirmId)}
          onOpenChange={(v) => !v && setConfirmId(null)}
          bookingId={confirmId}
          tables={tablesForConfirm}
          currentTableId={confirmTarget?.tableId ?? null}
          onDone={onDone}
        />
      )}
      {rejectId && <RejectDialog open={Boolean(rejectId)} onOpenChange={(v) => !v && setRejectId(null)} bookingId={rejectId} onDone={onDone} />}
    </section>
  )
}
