import { CalendarRange } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'
import type { Translator } from '@/lib/deposit/format'
import type { Trends } from '@/lib/reports/dashboard-view'
import { Block } from './block'

const NIGHTS_PER_WEEKDAY = 8 // 56 nights before tonight

/** Bookings per weekday over the last 8 weeks — which nights to staff up, which to promote. */
export function WeekdayChart({ days, weekdays, t, className = '' }: { days: Trends['weekdays']; weekdays: string[]; t: Translator; className?: string }) {
  const max = Math.max(0, ...days.map((d) => d.bookings))
  const busiest = max > 0 ? days.find((d) => d.bookings === max)?.dow : undefined
  return (
    <Block title={t('weekdaysTitle')} aside={t('weekdaysHint')} className={className} testId="overview-weekdays">
      {max === 0 ? (
        <EmptyState icon={CalendarRange} message={t('weekdaysEmpty')} />
      ) : (
        <>
          <ol className="flex h-32 items-end gap-2">
            {days.map((d) => {
              const label = t('weekdayCell', { day: weekdays[d.dow], count: d.bookings, people: d.people })
              const top = d.dow === busiest
              return (
                <li key={d.dow} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={label} data-testid="weekday-cell" data-dow={d.dow} data-bookings={d.bookings} data-closed={d.closed}>
                  <span className={`text-xs font-semibold tnum ${d.bookings ? 'text-ink' : 'text-muted-token'}`} aria-hidden>
                    {d.closed && !d.bookings ? t('weekdayClosed') : d.bookings}
                  </span>
                  <div
                    aria-hidden
                    className={`w-full max-w-10 rounded-t-md ${d.closed ? 'bg-[repeating-linear-gradient(135deg,var(--line)_0_4px,transparent_4px_8px)]' : top ? 'bg-brand' : 'bg-brand/35'}`}
                    style={{ height: d.closed && !d.bookings ? '100%' : `${Math.max(d.bookings ? 6 : 2, (d.bookings / max) * 100)}%` }}
                  />
                  <span className={`text-xs ${top ? 'font-semibold text-ink' : 'text-muted-token'}`}>{weekdays[d.dow]}</span>
                  <span className="sr-only">{label}</span>
                </li>
              )
            })}
          </ol>
          {busiest !== undefined && (
            <p className="mt-3 text-xs text-muted-token tnum">
              {weekdays[busiest]} · {t('weekdayAvg', { avg: (max / NIGHTS_PER_WEEKDAY).toFixed(1) })}
            </p>
          )}
        </>
      )}
    </Block>
  )
}
