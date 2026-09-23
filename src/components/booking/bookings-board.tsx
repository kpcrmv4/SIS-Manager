'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { FloorPlan } from './floor-plan'
import { BookingList } from './booking-list'
import { ConfirmAssignDialog } from './confirm-assign-dialog'
import { RejectDialog } from './reject-dialog'
import type { NightBooking, ZoneRow } from '@/lib/booking/queries'
import type { AppLocale } from '@/lib/date'

export function BookingsBoard({
  view,
  night,
  locale,
  zones,
  bookings,
  isBarOrOwner,
  emptyZones,
}: {
  view: 'plan' | 'list'
  night: string
  locale: AppLocale
  zones: ZoneRow[]
  bookings: NightBooking[]
  isBarOrOwner: boolean
  emptyZones?: ReactNode
}) {
  const router = useRouter()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)

  const confirmTarget = bookings.find((b) => b.id === confirmId)
  const allTables = zones.flatMap((z) => z.tables)
  const tablesForConfirm = confirmTarget?.zoneId ? zones.find((z) => z.id === confirmTarget.zoneId)?.tables ?? allTables : allTables

  const onDone = () => router.refresh()

  return (
    <>
      {view === 'plan' ? (
        <FloorPlan zones={zones} bookings={bookings} night={night} emptyZones={emptyZones} />
      ) : (
        <BookingList
          bookings={bookings}
          night={night}
          locale={locale}
          isBarOrOwner={isBarOrOwner}
          onConfirm={isBarOrOwner ? setConfirmId : undefined}
          onReject={isBarOrOwner ? setRejectId : undefined}
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
