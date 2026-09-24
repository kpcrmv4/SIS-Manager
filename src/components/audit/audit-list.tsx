import { Fragment } from 'react'
import { CalendarDays, GlassWater, Printer, Settings2, UsersRound, Wine, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { bangkokDate, formatLongDate, formatTime, type AppLocale } from '@/lib/date'
import { changesOf, type AuditKind, type AuditRow } from '@/lib/audit/view'

const ICON: Record<AuditKind, LucideIcon> = { deposit: Wine, withdrawal: GlassWater, booking: CalendarDays, print: Printer, settings: Settings2, users: UsersRound }

export type AuditText = {
  /** what was done, in words */
  action: (row: AuditRow) => string
  /** a second line: the liquor and customer, or the booking's name, party and time */
  subject: (row: AuditRow) => string | null
  who: (row: AuditRow) => string
  role: (row: AuditRow) => string | null
  field: (key: string) => string
  value: (key: string, v: unknown) => string
  details: string
}

/** The log, one panel per Bangkok day, newest first. */
export function AuditList({
  rows,
  text,
  locale,
  branchNames,
  showBranch,
}: {
  rows: AuditRow[]
  text: AuditText
  locale: AppLocale
  branchNames: Record<string, string>
  showBranch: boolean
}) {
  const days: [string, AuditRow[]][] = []
  for (const row of rows) {
    const day = bangkokDate(row.at)
    const last = days[days.length - 1]
    if (last && last[0] === day) last[1].push(row)
    else days.push([day, [row]])
  }
  return (
    <div className="flex flex-col gap-4" data-testid="audit-list">
      {days.map(([day, list]) => (
        <section key={day} className="panel" aria-label={formatLongDate(day, locale)} data-testid="audit-day" data-day={day}>
          <h2 className="panel-head">{formatLongDate(day, locale)}</h2>
          <ol>
            {list.map((row) => {
              const Icon = ICON[row.category]
              const subject = text.subject(row)
              const role = text.role(row)
              const changes = changesOf(row)
              const branch = showBranch && row.branch_id ? branchNames[row.branch_id] : null
              return (
                <li key={row.id} className="audit-row" data-testid="audit-row" data-kind={row.category} data-action={row.action} data-target={row.target ?? ''}>
                  <span className={`audit-ic ${row.category}`} aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium text-ink">{text.action(row)}</span>
                      {row.target && <span className="audit-target">{row.target}</span>}
                    </div>
                    {subject && <div className="text-[13px] text-ink-2">{subject}</div>}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-token">
                      <time dateTime={row.at} className="tnum">
                        {formatTime(row.at, locale)}
                      </time>
                      <span aria-hidden>·</span>
                      <span data-testid="audit-who">{text.who(row)}</span>
                      {role && <Badge tone={row.actor_role === 'owner' ? 'brand' : row.actor_role === 'bar' ? 'gold' : 'info'}>{role}</Badge>}
                      {branch && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{branch}</span>
                        </>
                      )}
                    </div>
                    {changes.length > 0 && (
                      <details className="audit-details">
                        <summary className="btn-ghost btn-sm cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden" data-testid="audit-details">
                          {text.details}
                        </summary>
                        <dl className="audit-changes">
                          {changes.map((c) => (
                            <Fragment key={c.key}>
                              <dt>{text.field(c.key)}</dt>
                              <dd data-testid="audit-change" data-key={c.key}>
                                {c.diff ? (
                                  <>
                                    <span className="old">{text.value(c.key, c.from)}</span>
                                    <span aria-hidden> → </span>
                                    <span className="new">{text.value(c.key, c.to)}</span>
                                  </>
                                ) : (
                                  text.value(c.key, c.to)
                                )}
                              </dd>
                            </Fragment>
                          ))}
                        </dl>
                      </details>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
