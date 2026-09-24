import { BarChart3 } from 'lucide-react'
import type { Translator } from '@/lib/deposit/format'
import { formatShortDate, type AppLocale } from '@/lib/date'
import type { Bucket } from '@/lib/reports/report-view'
import { EmptyState } from '@/components/ui/states'
import { Block } from '@/components/overview/block'

type Props = { buckets: Bucket[]; unit: 'day' | 'week'; t: Translator; locale: AppLocale; className?: string }

const pct = (n: number, max: number) => `${max ? Math.max(n ? 4 : 0, (n / max) * 100) : 0}%`

/** The bars' own minimum widths plus the gap-1 (4px) between them — narrower, and a long range spills out of the scroller. */
const railWidth = (n: number, bar: number) => n * (bar + 4) - 4

/**
 * Axis labels: a day's number, or a week's start date; thinned so at most ~16 show. A range wider
 * than the screen scrolls sideways and opens on the newest days (rtl scroller, ltr bars).
 */
function axis(b: Bucket, i: number, n: number, unit: Props['unit'], locale: AppLocale) {
  const step = Math.max(1, Math.ceil(n / 16))
  if (i % step !== 0) return ''
  return unit === 'day' ? String(Number(b.from.slice(8))) : formatShortDate(`${b.from}T12:00:00+07:00`, locale).replace(/\s?\d{2,4}$/, '')
}

const when = (b: Bucket, locale: AppLocale) => {
  const a = formatShortDate(`${b.from}T12:00:00+07:00`, locale)
  return b.from === b.to ? a : `${a} – ${formatShortDate(`${b.to}T12:00:00+07:00`, locale)}`
}

function Legend({ items }: { items: { cls: string; label: string }[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className={`size-2 rounded-xs ${i.cls}`} aria-hidden />
          {i.label}
        </span>
      ))}
    </span>
  )
}

/** Bottles deposited next to bottles withdrawn, per day (or per week for long ranges). */
export function FlowChart({ buckets, unit, t, locale, className = '' }: Props) {
  const max = Math.max(0, ...buckets.flatMap((b) => [b.bottles_in, b.bottles_out]))
  return (
    <Block
      title={`${t('chartFlow')} · ${t(unit === 'day' ? 'perDay' : 'perWeek')}`}
      aside={<Legend items={[{ cls: 'bg-accent', label: t('legendIn') }, { cls: 'bg-status-info', label: t('legendOut') }]} />}
      className={className}
      testId="report-chart-flow"
    >
      {max === 0 ? (
        <EmptyState icon={BarChart3} message={t('chartEmpty')} />
      ) : (
        <div className="overflow-x-auto pb-1 no-scrollbar" dir="rtl">
          <ol dir="ltr" className="flex h-44 items-end gap-1" style={{ minWidth: railWidth(buckets.length, 10) }} data-unit={unit}>
            {buckets.map((b, i) => {
              const label = t('barFlow', { date: when(b, locale), in: b.bottles_in, out: b.bottles_out })
              return (
                <li key={b.from} className="flex h-full min-w-2.5 flex-1 flex-col items-center justify-end gap-1" title={label} data-testid="report-bar" data-from={b.from} data-in={b.bottles_in} data-out={b.bottles_out}>
                  <div className="flex h-full w-full items-end justify-center gap-px" aria-hidden>
                    <span className="w-1/2 max-w-3 rounded-t-xs bg-accent" style={{ height: pct(b.bottles_in, max) }} />
                    <span className="w-1/2 max-w-3 rounded-t-xs bg-status-info" style={{ height: pct(b.bottles_out, max) }} />
                  </div>
                  <span className="h-3 text-[10px] leading-none text-muted-token tnum" aria-hidden>
                    {axis(b, i, buckets.length, unit, locale)}
                  </span>
                  <span className="sr-only">{label}</span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </Block>
  )
}

/** Bookings per night: arrived, still expected / other, no-show — stacked. */
export function BookingsChart({ buckets, unit, t, locale, className = '' }: Props) {
  const max = Math.max(0, ...buckets.map((b) => b.bookings))
  return (
    <Block
      title={`${t('chartBookings')} · ${t(unit === 'day' ? 'perDay' : 'perWeek')}`}
      aside={
        <Legend
          items={[
            { cls: 'bg-status-done', label: t('legendArrived') },
            { cls: 'bg-status-info', label: t('legendExpected') },
            { cls: 'bg-urgent', label: t('legendNoShow') },
          ]}
        />
      }
      className={className}
      testId="report-chart-bookings"
    >
      {max === 0 ? (
        <EmptyState icon={BarChart3} message={t('chartEmpty')} />
      ) : (
        <div className="overflow-x-auto pb-1 no-scrollbar" dir="rtl">
          <ol dir="ltr" className="flex h-44 items-end gap-1" style={{ minWidth: railWidth(buckets.length, 8) }} data-unit={unit}>
            {buckets.map((b, i) => {
              const other = Math.max(0, b.bookings - b.arrived - b.no_shows)
              const label = t('barBookings', { date: when(b, locale), count: b.bookings, arrived: b.arrived, noShows: b.no_shows })
              return (
                <li key={b.from} className="flex h-full min-w-2 flex-1 flex-col items-center justify-end gap-1" title={label} data-testid="report-bar-bookings" data-from={b.from} data-bookings={b.bookings} data-arrived={b.arrived} data-no-shows={b.no_shows}>
                  <div className="flex h-full w-full max-w-5 flex-col-reverse overflow-hidden rounded-t-xs" aria-hidden>
                    <span className="bg-status-done" style={{ height: pct(b.arrived, max) }} />
                    <span className="bg-status-info" style={{ height: pct(other, max) }} />
                    <span className="bg-urgent/80" style={{ height: pct(b.no_shows, max) }} />
                  </div>
                  <span className="h-3 text-[10px] leading-none text-muted-token tnum" aria-hidden>
                    {axis(b, i, buckets.length, unit, locale)}
                  </span>
                  <span className="sr-only">{label}</span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </Block>
  )
}
