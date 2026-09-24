import Link from 'next/link'
import { ArrowRight, ChevronDown, CircleCheck, CircleDashed, Rocket } from 'lucide-react'
import type { SetupItem, SetupKey } from '@/lib/reports/dashboard-view'

/**
 * "ตั้งค่าร้านให้พร้อมใช้งาน" on /settings/branch (owner, R-034): a small card — progress bar and
 * the next open step with its link — and every step folded under "ดูทุกขั้นตอน" (native
 * <details>, no script). All done → one green line, the steps still one tap away.
 */
export function SetupCard({
  items,
  title,
  progress,
  nextLabel,
  allLabel,
  doneLabel,
  go,
  labels,
  hints,
}: {
  items: SetupItem[]
  title: string
  progress: string
  nextLabel: string
  allLabel: string
  doneLabel: string
  go: string
  labels: Record<SetupKey, string>
  hints: Record<SetupKey, string>
}) {
  const done = items.filter((i) => i.done).length
  const next = items.find((i) => !i.done)
  const pct = items.length ? Math.round((done / items.length) * 100) : 0

  return (
    <section aria-label={title} className="card-surface mb-5 p-4" data-testid="setup-card" data-done={done} data-total={items.length}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <Rocket className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{title}</span>
        </h2>
        <span className="shrink-0 text-xs text-muted-token tnum" data-testid="setup-progress">
          {progress}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className={`h-full rounded-full ${next ? 'bg-accent' : 'bg-status-done'}`} style={{ width: `${pct}%` }} />
      </div>

      {next ? (
        <div className="mt-3 flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5" data-testid="setup-next" data-key={next.key}>
          <CircleDashed className="size-4 shrink-0 text-status-progress" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-muted-token">{nextLabel}</div>
            <div className="truncate text-sm font-medium text-ink">{labels[next.key]}</div>
          </div>
          <Link href={next.href} className="btn-secondary btn-sm shrink-0">
            {go}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-status-done" data-testid="setup-done">
          <CircleCheck className="size-4" aria-hidden />
          {doneLabel}
        </p>
      )}

      <details className="group mt-2">
        <summary className="btn-ghost btn-sm cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden" data-testid="setup-all">
          {allLabel}
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="mt-1.5 flex flex-col divide-y divide-line-soft">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-2.5 py-2" data-testid="setup-item" data-key={i.key} data-done={i.done}>
              {i.done ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-status-done" aria-hidden />
              ) : (
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-token" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${i.done ? 'text-muted-token' : 'font-medium text-ink'}`}>{labels[i.key]}</div>
                {!i.done && <div className="text-xs leading-relaxed text-muted-token">{hints[i.key]}</div>}
              </div>
              {!i.done && (
                <Link href={i.href} className="btn-ghost btn-sm shrink-0">
                  {go}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
