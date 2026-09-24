import Link from 'next/link'
import { ArrowRight, GlassWater, PackagePlus } from 'lucide-react'
import type { getTranslations } from 'next-intl/server'
import { StatusDot } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { tonightHours, tonightTotals, type DashTonight } from '@/lib/reports/dashboard-view'
import { Block } from './block'
import { LiveBadge } from './overview-live'

type T = Awaited<ReturnType<typeof getTranslations>>

// one colour per booking state, the same in the bars and the legend
const SEG = {
  arrived: 'bg-status-done',
  waiting: 'bg-status-info',
  pending: 'bg-status-progress',
  no_show: 'bg-urgent',
} as const

/** Tonight across the active branches: bookings per hour of the night, who came, bottles in and out. Live. */
export function TonightPanel({ tonight, t, nightLabel, planHref, className = '' }: { tonight: DashTonight; t: T; nightLabel: string; planHref: string; className?: string }) {
  const hours = tonightHours(tonight)
  const total = tonightTotals(tonight)
  const max = Math.max(1, ...hours.map((h) => h.bookings))

  return (
    <Block
      title={`${t('tonightTitle')} · ${nightLabel}`}
      aside={<LiveBadge label={t('live')} />}
      className={className}
      testId="overview-tonight"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-bold text-ink tnum" data-testid="tonight-total" data-bookings={total.bookings} data-people={total.people}>
          {t('tonightBooked', { count: total.bookings })}
        </span>
        <span className="text-sm text-muted-token tnum">{t('tonightPeople', { count: total.people })}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" data-testid="tonight-legend">
        <span data-testid="tonight-arrived" data-count={total.arrived}>
          <StatusDot tone="done">{t('tonightArrived', { count: total.arrived })}</StatusDot>
        </span>
        <span data-testid="tonight-waiting" data-count={total.waiting}>
          <StatusDot tone="info">{t('tonightWaiting', { count: total.waiting })}</StatusDot>
        </span>
        <span data-testid="tonight-pending" data-count={total.pending}>
          <StatusDot tone="progress">{t('tonightPending', { count: total.pending })}</StatusDot>
        </span>
        <span data-testid="tonight-no-show" data-count={total.no_show}>
          <StatusDot tone="urgent">{t('tonightNoShow', { count: total.no_show })}</StatusDot>
        </span>
      </div>

      {hours.length === 0 ? (
        <div className="mt-3">
          <EmptyState message={t('tonightEmpty')} />
        </div>
      ) : (
        <ol className="mt-4 flex items-end gap-1.5 overflow-x-auto pb-1 no-scrollbar sm:gap-2" data-testid="tonight-hours">
          {hours.map((h) => {
            const waiting = h.bookings - h.arrived - h.pending - h.no_show
            const time = `${String(h.hour).padStart(2, '0')}:00`
            const seg = (n: number) => `${(n / max) * 100}%`
            return (
              <li
                key={h.hour}
                className="flex min-w-9 flex-1 flex-col items-center gap-1"
                data-testid="tonight-hour"
                data-hour={h.hour}
                data-bookings={h.bookings}
                title={t('hourBar', { time, count: h.bookings })}
              >
                <span className={`text-xs font-semibold tnum ${h.bookings ? 'text-ink' : 'text-transparent'}`} aria-hidden>
                  {h.bookings}
                </span>
                <div className="flex h-24 w-full max-w-12 flex-col-reverse overflow-hidden rounded-md bg-surface-2" aria-hidden>
                  <div className={SEG.arrived} style={{ height: seg(h.arrived) }} />
                  <div className={SEG.waiting} style={{ height: seg(waiting) }} />
                  <div className={SEG.pending} style={{ height: seg(h.pending) }} />
                  <div className={`${SEG.no_show} opacity-70`} style={{ height: seg(h.no_show) }} />
                </div>
                <span className="text-[11px] text-muted-token tnum">{time}</span>
                <span className="sr-only">{t('hourBar', { time, count: h.bookings })}</span>
              </li>
            )
          })}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3 text-sm">
        <span className="flex items-center gap-1.5 text-ink-2 tnum" data-testid="tonight-bottles" data-in={tonight.bottles_in} data-out={tonight.bottles_out}>
          <PackagePlus className="size-4 text-muted-token" aria-hidden />
          <GlassWater className="-ml-0.5 size-4 text-muted-token" aria-hidden />
          {t('tonightBottles', { in: tonight.bottles_in, out: tonight.bottles_out })}
        </span>
        <Link href={planHref} className="btn-ghost btn-sm">
          {t('tonightPlan')}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </Block>
  )
}
