import 'server-only'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AlertTriangle } from 'lucide-react'
import { closedTables, nightBookings, nightStats } from '@/lib/booking/queries'
import type { ZoneRow } from '@/lib/booking/queries'
import { bookingAvailability } from '@/lib/booking/actions'
import { BookingsBoard } from '@/components/booking/bookings-board'
import type { BookingSettingsForForm } from '@/components/booking/booking-form-dialog'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import type { Role } from '@/lib/auth/actor'
import { isBarOrOwner } from '@/lib/auth/actor'
import { formatLongDate, type AppLocale } from '@/lib/date'

/**
 * The night-specific half of /bookings — behind Suspense so switching nights
 * shows a skeleton instead of blocking the header/tabs. Zones and settings are
 * fetched by the page itself (rarely change, needed immediately for the
 * รับจอง button); this component owns the data that changes per night.
 */
export async function BookingsContent({
  branchId,
  night,
  view,
  role,
  locale,
  isOwner,
  zones,
  settings,
}: {
  branchId: string
  night: string
  view: 'plan' | 'list'
  role: Role
  locale: AppLocale
  isOwner: boolean
  zones: ZoneRow[]
  settings: BookingSettingsForForm
}) {
  const t = await getTranslations('bookings')
  const tErr = await getTranslations('bookingErrors')

  const [{ bookings, error: bError }, availabilityRes, closed] = await Promise.all([
    nightBookings(branchId, night),
    bookingAvailability(branchId, night, night),
    closedTables(branchId, night),
  ])

  if (bError || !availabilityRes.ok || closed.error) {
    return <RefreshRetry />
  }

  const nightInfo = availabilityRes.data.nights[0]
  // the shop may still take a booking on this night — the LINE-only rules (cutoff, too far) don't bind staff
  const canBook = !(nightInfo?.closed && (nightInfo.reason === 'past' || nightInfo.reason === 'closed_weekday' || nightInfo.reason === 'blackout'))
  const totalTables = zones.flatMap((z) => z.tables).length
  const stats = nightStats(bookings, totalTables)

  const emptyZones = isOwner ? (
    <div className="panel px-6 py-12 text-center">
      <p className="mx-auto mb-4 max-w-[46ch] text-base leading-6 text-muted-token">{t('emptyZonesBody')}</p>
      <Link href="/settings/tables" className="btn-secondary mx-auto inline-flex w-fit">
        {t('emptyZones')}
      </Link>
    </div>
  ) : undefined

  return (
    <>
      {/* the night in four small figures (owner, 2026-09-27) — one row, quieter than the plan below */}
      <div className="mb-3 grid grid-cols-4 gap-2" data-testid="bookings-subtitle" title={formatLongDate(`${night}T00:00:00Z`, locale)}>
        {[
          { key: 'booked', label: t('statBooked'), value: stats.reservations, unit: t('statTables'), tone: 'text-status-info' },
          { key: 'people', label: t('statPeople'), value: stats.people, unit: null, tone: 'text-ink' },
          { key: 'arrived', label: t('statArrived'), value: stats.arrived, unit: null, tone: 'text-status-done' },
          { key: 'free', label: t('statFree'), value: Math.max(0, stats.capacity - stats.booked), unit: t('statTables'), tone: 'text-ink' },
        ].map((f) => (
          <div key={f.key} className="card-surface flex min-w-0 flex-col items-center px-1.5 py-2" data-testid="bookings-stat" data-key={f.key} data-value={f.value}>
            <span className="truncate text-[11px] text-muted-token">{f.label}</span>
            <span className={`text-xl font-bold leading-tight tnum ${f.value > 0 ? f.tone : 'text-muted-token'}`}>
              {f.value}
              {f.unit && <span className="ml-0.5 text-[11px] font-medium text-muted-token">{f.unit}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm empty:hidden">
        {nightInfo?.closed && (
          <span className="inline-flex items-center gap-1 text-status-progress" role="status" data-testid="closed-night-banner">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {t('closedNight', {
              reason: nightInfo.reason === 'blackout' && nightInfo.blackout_reason ? nightInfo.blackout_reason : tErr(nightInfo.reason ?? 'past'),
            })}
          </span>
        )}
      </div>
      <BookingsBoard
        branchId={branchId}
        view={view}
        night={night}
        locale={locale}
        zones={zones}
        bookings={bookings}
        closedTableIds={closed.tableIds}
        settings={settings}
        canBook={canBook}
        isBarOrOwner={isBarOrOwner(role)}
        emptyZones={emptyZones}
      />
    </>
  )
}
