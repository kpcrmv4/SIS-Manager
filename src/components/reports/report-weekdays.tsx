import { CalendarRange } from 'lucide-react'
import type { Translator } from '@/lib/deposit/format'
import { EmptyState } from '@/components/ui/states'
import { Block } from '@/components/overview/block'

type Day = { dow: number; bottles_in: number; bookings: number }

/** Which weekdays carry the business in the chosen period: bottles deposited and bookings, each on its own scale. */
export function ReportWeekdays({ days, weekdays, t, className = '' }: { days: Day[]; weekdays: string[]; t: Translator; className?: string }) {
  const maxIn = Math.max(0, ...days.map((d) => d.bottles_in))
  const maxBk = Math.max(0, ...days.map((d) => d.bookings))
  const pct = (n: number, max: number) => `${max ? Math.max(n ? 5 : 0, (n / max) * 100) : 0}%`
  return (
    <Block
      title={t('weekdaysTitle')}
      aside={
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-xs bg-accent" aria-hidden />
            {t('legendIn')}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-xs bg-brand" aria-hidden />
            {t('legendBookings')}
          </span>
        </span>
      }
      className={className}
      testId="report-weekdays"
    >
      {maxIn === 0 && maxBk === 0 ? (
        <EmptyState icon={CalendarRange} message={t('chartEmpty')} />
      ) : (
        <ol className="flex h-36 items-end gap-2">
          {days.map((d) => {
            const label = t('weekdayBar', { day: weekdays[d.dow], in: d.bottles_in, bookings: d.bookings })
            return (
              <li key={d.dow} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={label} data-testid="report-weekday" data-dow={d.dow} data-in={d.bottles_in} data-bookings={d.bookings}>
                <div className="flex h-full w-full items-end justify-center gap-0.5" aria-hidden>
                  <span className="w-1/2 max-w-4 rounded-t-xs bg-accent" style={{ height: pct(d.bottles_in, maxIn) }} />
                  <span className="w-1/2 max-w-4 rounded-t-xs bg-brand" style={{ height: pct(d.bookings, maxBk) }} />
                </div>
                <span className="text-xs text-muted-token">{weekdays[d.dow]}</span>
                <span className="sr-only">{label}</span>
              </li>
            )
          })}
        </ol>
      )}
    </Block>
  )
}
