'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import type { NightBooking, ZoneRow } from '@/lib/booking/queries'
import { LIVE_STATUSES, cellState } from '@/lib/booking/format'

/**
 * The floor plan: one grid of table cells per zone. Cell state (free / booked /
 * arrived / late) depends on wall-clock time, so it is computed client-side and
 * re-evaluated on an interval — a page left open past a booking's slot should
 * turn it "late" without a manual refresh.
 */
export function FloorPlan({
  zones,
  bookings,
  night,
  emptyZones,
  onSelectBooking,
}: {
  zones: ZoneRow[]
  bookings: NightBooking[]
  night: string
  emptyZones?: React.ReactNode
  onSelectBooking?: (bookingId: string) => void
}) {
  const t = useTranslations('bookings')
  const tc = useTranslations('common')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const byTable = new Map<string, NightBooking>()
  for (const b of bookings) {
    if (b.tableId && LIVE_STATUSES.includes(b.status)) byTable.set(b.tableId, b)
  }

  if (!zones.length) {
    return emptyZones ? <>{emptyZones}</> : <EmptyState message={t('emptyZones')} />
  }

  return (
    <div>
      <div className="legend mb-3">
        <span>
          <i style={{ borderColor: 'var(--line)' }} />
          {t('legendFree')}
        </span>
        <span>
          <i style={{ borderColor: 'var(--info)', background: 'var(--info-bg)' }} />
          {t('legendBooked')}
        </span>
        <span>
          <i style={{ borderColor: 'var(--status-done)', background: 'var(--status-done-bg)' }} />
          {t('legendArrived')}
        </span>
        <span>
          <i style={{ borderColor: 'var(--status-progress)', background: 'var(--status-progress-bg)' }} />
          {t('legendLate')}
        </span>
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
                  const state = booking ? cellState(booking.status, night, booking.slotTime, now) : 'free'
                  const cls = ['t-cell', table.shape === 'round' ? 'round' : '', state !== 'free' ? state : ''].filter(Boolean).join(' ')
                  return (
                    <button
                      key={table.id}
                      type="button"
                      className={cls}
                      data-testid="table-cell"
                      data-state={state}
                      onClick={() => booking && onSelectBooking?.(booking.id)}
                    >
                      <b>{table.label}</b>
                      <span className="who">{booking ? booking.name : t('free')}</span>
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
