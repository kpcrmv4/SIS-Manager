'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { replaceQuery, uuidParam } from '@/lib/url-state'
import { FloorPlan } from './floor-plan'
import { BookingList } from './booking-list'
import { ConfirmAssignDialog } from './confirm-assign-dialog'
import { RejectDialog } from './reject-dialog'
import { BookingDetailDialog } from './booking-detail-dialog'
import type { NightBooking, ZoneRow } from '@/lib/booking/queries'
import type { AppLocale } from '@/lib/date'

export function BookingsBoard({
  branchId,
  view,
  night,
  locale,
  zones,
  bookings,
  isBarOrOwner,
  emptyZones,
}: {
  branchId: string
  view: 'plan' | 'list'
  night: string
  locale: AppLocale
  zones: ZoneRow[]
  bookings: NightBooking[]
  isBarOrOwner: boolean
  emptyZones?: ReactNode
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  // the open booking stays in the address (?b=, R-050): Back from its customer page reopens it
  const [detailId, setDetail] = useState<string | null>(() => uuidParam(sp.get('b')))
  const setDetailId = (id: string | null) => {
    setDetail(id)
    replaceQuery({ b: id })
  }

  const confirmTarget = bookings.find((b) => b.id === confirmId)
  const allTables = zones.flatMap((z) => z.tables)
  const tablesForConfirm = confirmTarget?.zoneId ? zones.find((z) => z.id === confirmTarget.zoneId)?.tables ?? allTables : allTables

  const onDone = () => router.refresh()

  return (
    <>
      {view === 'plan' ? (
        <FloorPlan zones={zones} bookings={bookings} night={night} emptyZones={emptyZones} onSelectBooking={setDetailId} />
      ) : (
        <BookingList
          bookings={bookings}
          night={night}
          locale={locale}
          isBarOrOwner={isBarOrOwner}
          onSelectBooking={setDetailId}
          onConfirm={isBarOrOwner ? setConfirmId : undefined}
          onReject={isBarOrOwner ? setRejectId : undefined}
        />
      )}

      {detailId && (
        <BookingDetailDialog
          bookingId={detailId}
          branchId={branchId}
          locale={locale}
          onOpenChange={(v) => !v && setDetailId(null)}
          onChanged={onDone}
        />
      )}

      {confirmId && (
        <ConfirmAssignDialog
          open={Boolean(confirmId)}
          onOpenChange={(v) => !v && setConfirmId(null)}
          bookingId={confirmId}
          tables={tablesForConfirm}
          onDone={onDone}
        />
      )}
      {rejectId && (
        <RejectDialog open={Boolean(rejectId)} onOpenChange={(v) => !v && setRejectId(null)} bookingId={rejectId} onDone={onDone} />
      )}
    </>
  )
}
