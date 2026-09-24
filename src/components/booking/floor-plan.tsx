'use client'

import { useTranslations } from 'next-intl'
import { useNow } from '@/lib/use-now'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import type { NightBooking, TableRow, ZoneRow } from '@/lib/booking/queries'
import { LIVE_STATUSES, cellState, type CellState } from '@/lib/booking/format'

/**
 * The floor plan: one grid of table cells per zone. Cell state (free / waiting / booked /
 * arrived / late) depends on wall-clock time, so it is computed client-side and re-evaluated
 * on an interval — a page left open past a booking's slot should turn it "late" without a
 * manual refresh. A table closed for the night with no booking on it reads ปิดจอง (R-056).
 * A cell with a booking opens it; a free one opens รับจอง for that table and a closed one
 * opens it again, when the caller passes those handlers (R-055).
 */
export function FloorPlan({
  zones,
  bookings,
  night,
  closedTableIds = [],
  emptyZones,
  onSelectBooking,
  onSelectFree,
  onSelectClosed,
}: {
  zones: ZoneRow[]
  bookings: NightBooking[]
  night: string
  closedTableIds?: string[]
  emptyZones?: React.ReactNode
  onSelectBooking?: (bookingId: string) => void
  onSelectFree?: (table: TableRow) => void
  onSelectClosed?: (table: TableRow) => void
}) {
  const t = useTranslations('bookings')
  const tc = useTranslations('common')
  // null until hydrated; epoch 0 is before every slot, so nothing reads as late on the server
  const now = useNow() ?? 0

  const byTable = new Map<string, NightBooking>()
  for (const b of bookings) {
    if (b.tableId && LIVE_STATUSES.includes(b.status)) byTable.set(b.tableId, b)
  }
  const closed = new Set(closedTableIds)

  if (!zones.length) {
    return emptyZones ? <>{emptyZones}</> : <EmptyState message={t('emptyZones')} />
  }

  const legend: [string, React.CSSProperties][] = [
    [t('legendFree'), { borderColor: 'var(--line)' }],
    [t('legendPending'), { borderColor: 'var(--status-violet)', background: 'var(--status-violet-bg)' }],
    [t('legendBooked'), { borderColor: 'var(--info)', background: 'var(--info-bg)' }],
    [t('legendArrived'), { borderColor: 'var(--status-done)', background: 'var(--status-done-bg)' }],
    [t('legendLate'), { borderColor: 'var(--status-progress)', background: 'var(--status-progress-bg)' }],
    [t('legendClosed'), { borderColor: 'var(--line-strong)', borderStyle: 'dashed', background: 'var(--surface-2)' }],
  ]

  return (
    <div>
      <div className="legend mb-3">
        {legend.map(([label, style]) => (
          <span key={label}>
            <i style={style} />
            {label}
          </span>
        ))}
      </div>
      <div className="card-surface flex flex-col gap-5 p-4">
        {zones.map((zone) => (
          <div key={zone.id}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              {zone.name}
              <Badge tone="pending">{t('zoneTables', { count: zone.tables.length })}</Badge>
            </h3>
            {zone.tables.length === 0 ? (
              <p className="text-sm text-muted-token">—</p>
            ) : (
              <div className="tables-grid">
                {zone.tables.map((table) => {
                  const booking = byTable.get(table.id)
                  const state: CellState | 'closed' = booking ? cellState(booking.status, night, booking.slotTime, now) : closed.has(table.id) ? 'closed' : 'free'
                  const onSelect = booking
                    ? onSelectBooking && (() => onSelectBooking(booking.id))
                    : state === 'closed'
                      ? onSelectClosed && (() => onSelectClosed(table))
                      : onSelectFree && (() => onSelectFree(table))
                  const cls = ['t-cell', table.shape === 'round' ? 'round' : '', state !== 'free' ? state : ''].filter(Boolean).join(' ')
                  const who = booking ? (state === 'pending' ? t('legendPending') : booking.name) : state === 'closed' ? t('legendClosed') : t('free')
                  return (
                    <button
                      key={table.id}
                      type="button"
                      className={cls}
                      data-testid="table-cell"
                      data-state={state}
                      data-label={table.label}
                      data-action={onSelect ? (booking ? 'open' : state === 'closed' ? 'reopen' : 'book') : undefined}
                      onClick={onSelect || undefined}
                    >
                      <b>{table.label}</b>
                      <span className="who">{who}</span>
                      <span className="num">
                        {booking ? `${booking.slotTime.slice(0, 5)} · ${booking.party}` : tc('seats', { count: table.seatsMax })}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
