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
import { BookingFormDialog, type BookingSettingsForForm } from './booking-form-dialog'
import { TableClosedDialog } from './table-closed-dialog'
import type { NightBooking, TableRow, ZoneRow } from '@/lib/booking/queries'
import type { AppLocale } from '@/lib/date'

export function BookingsBoard({
  branchId,
  view,
  night,
  locale,
  zones,
  bookings,
  closedTableIds,
  settings,
  canBook,
  isBarOrOwner,
  emptyZones,
}: {
  branchId: string
  view: 'plan' | 'list'
  night: string
  locale: AppLocale
  zones: ZoneRow[]
  bookings: NightBooking[]
  closedTableIds: string[]
  settings: BookingSettingsForForm
  /** the shop still takes bookings on this night (not past, not closed) — a free table opens รับจอง */
  canBook: boolean
  isBarOrOwner: boolean
  emptyZones?: ReactNode
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  // a free table tapped on the plan: รับจอง for it (R-055); a closed one: open it again (R-056)
  const [bookTable, setBookTable] = useState<TableRow | null>(null)
  const [closedTable, setClosedTable] = useState<TableRow | null>(null)
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
        <FloorPlan
          zones={zones}
          bookings={bookings}
          night={night}
          closedTableIds={closedTableIds}
          emptyZones={emptyZones}
          onSelectBooking={setDetailId}
          onSelectFree={canBook ? setBookTable : undefined}
          onSelectClosed={isBarOrOwner ? setClosedTable : undefined}
        />
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

      {bookTable && (
        <BookingFormDialog
          key={bookTable.id}
          open
          onOpenChange={(v) => !v && setBookTable(null)}
          branchId={branchId}
          night={night}
          zones={zones}
          settings={settings}
          initialZoneId={bookTable.zoneId}
          initialTableId={bookTable.id}
          canCloseTable={isBarOrOwner}
          onCreated={onDone}
        />
      )}
      {closedTable && (
        <TableClosedDialog
          open
          onOpenChange={(v) => !v && setClosedTable(null)}
          tableId={closedTable.id}
          tableLabel={closedTable.label}
          night={night}
          onDone={onDone}
        />
      )}

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
      {rejectId && (
        <RejectDialog open={Boolean(rejectId)} onOpenChange={(v) => !v && setRejectId(null)} bookingId={rejectId} onDone={onDone} />
      )}
    </>
  )
}
