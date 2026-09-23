import Link from 'next/link'
import { ArrowRight, CircleCheck, CircleDashed, Rocket } from 'lucide-react'
import type { SetupItem, SetupKey } from '@/lib/reports/dashboard-view'

/**
 * Shown only while a setup step is open at some active branch. Open steps are cards with the
 * link that fixes them; finished steps shrink to a line of ticks. Gone once everything is done.
 */
export function SetupChecklist({
  title,
  progress,
  go,
  items,
  labels,
  hints,
  missing,
}: {
  title: string
  progress: string
  go: string
  items: SetupItem[]
  labels: Record<SetupKey, string>
  hints: Record<SetupKey, string>
  missing: (names: string[]) => string | null
}) {
  const open = items.filter((i) => !i.done)
  const done = items.filter((i) => i.done)
  const pct = items.length ? Math.round((done.length / items.length) * 100) : 0

  return (
    <section aria-label={title} className="mb-5 rounded-lg border border-line border-l-4 border-l-accent bg-card p-4 shadow-e1" data-testid="overview-setup">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Rocket className="size-4 text-accent" aria-hidden />
          {title}
        </h2>
        <span className="text-sm text-muted-token tnum" data-testid="setup-progress">
          {progress}
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className="h-full rounded-full bg-status-done" style={{ width: `${pct}%` }} />
      </div>

      <ul className="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {open.map((r) => {
          const where = missing(r.missing)
          return (
            <li key={r.key} className="flex items-start gap-2.5 rounded-md border border-line-soft bg-surface p-3" data-testid="setup-item" data-key={r.key} data-done="false">
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-status-progress" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{labels[r.key]}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-muted-token">
                  {hints[r.key]}
                  {where && <span className="block text-status-progress">{where}</span>}
                </div>
              </div>
              <Link href={r.href} className="btn-secondary btn-sm shrink-0" data-testid="setup-go">
                {go}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>

      {done.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {done.map((r) => (
            <li key={r.key} className="inline-flex items-center gap-1.5 text-sm text-muted-token" data-testid="setup-item" data-key={r.key} data-done="true">
              <CircleCheck className="size-4 shrink-0 text-status-done" aria-hidden />
              {labels[r.key]}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
