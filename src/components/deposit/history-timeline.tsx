import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/ui/states'
import { eventText } from '@/lib/deposit/format'
import { formatShortDate, formatTime, type AppLocale } from '@/lib/date'
import type { DepositEventRow } from '@/lib/deposit/detail'

/** Newest-first history — one deposit_events row per line, with actor names for staff/bar actions. */
export async function HistoryTimeline({ events, locale }: { events: DepositEventRow[]; locale: AppLocale }) {
  const t = await getTranslations()
  const tc = await getTranslations('common')
  const td = await getTranslations('deposit')

  return (
    <div className="card-surface p-4">
      <h2 className="sec-head">{td('history')}</h2>
      {events.length === 0 ? (
        <EmptyState message={tc('notFound')} />
      ) : (
        <div>
          {events.map((e) => {
            const date = formatShortDate(e.createdAt, locale)
            const time = tc('timeSuffix', { time: formatTime(e.createdAt, locale) })
            const actor = e.actorKind === 'staff' && e.actorName ? `${e.actorRole ?? ''} ${e.actorName}`.trim() : null
            const meta = actor ? `${date} · ${time} · ${actor}` : `${date} · ${time}`
            return (
              <div key={e.id} className="tl" data-testid="history-event">
                <span className="dot" aria-hidden />
                <div>
                  <div>{eventText(t, e, locale)}</div>
                  {e.action === 'disposed' && typeof e.payload.disposal_code === 'string' && (
                    <Link href={`/deposits/disposals/${e.payload.disposal_code}`} className="code text-brand hover:underline">
                      {e.payload.disposal_code}
                    </Link>
                  )}
                  <div className="s num">{meta}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
