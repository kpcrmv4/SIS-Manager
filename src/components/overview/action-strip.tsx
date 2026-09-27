import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { CalendarClock, ChevronRight, ClipboardCheck, GlassWater, Hourglass, MessageCircleWarning, MessageSquarePlus, Printer, Trash2 } from 'lucide-react'
import { StatusDot } from '@/components/ui/badge'
import type { ActionItem, ActionKey } from '@/lib/reports/dashboard-view'

const ICON: Record<ActionKey, LucideIcon> = {
  to_confirm: ClipboardCheck,
  requests: MessageSquarePlus,
  withdrawals: GlassWater,
  bookings_pending: CalendarClock,
  expiring: Hourglass,
  to_dispose: Trash2,
  printers_offline: Printer,
  line_failed: MessageCircleWarning,
}

const BOX: Record<ActionItem['tone'], string> = {
  progress: 'text-status-progress bg-status-progress-bg',
  info: 'text-status-info bg-status-info-bg',
  violet: 'text-status-violet bg-status-violet-bg',
  urgent: 'text-urgent bg-urgent-bg',
}
const COUNT: Record<ActionItem['tone'], string> = {
  progress: 'text-status-progress',
  info: 'text-status-info',
  violet: 'text-status-violet',
  urgent: 'text-urgent',
}

/**
 * "ต้องจัดการ" (owner, redesigned 2026-09-27): every waiting job across the branches as a list — the
 * urgent ones first, each row saying what it is, where and what to do, with its count large on the
 * right. The header sums the jobs and the urgent ones. Each row opens its list.
 */
export function ActionStrip({
  title,
  none,
  items,
  labels,
  hints,
  summary,
}: {
  title: string
  none: string
  items: ActionItem[]
  labels: Record<ActionKey, string>
  hints: Record<ActionKey, string>
  summary: { total: string; urgent: string | null }
}) {
  return (
    <section aria-label={title} className="mb-5 rounded-lg border border-line bg-card px-4 pb-1 pt-3.5 shadow-e1" data-testid="overview-actions">
      <div className="flex items-baseline justify-between gap-2 pb-1.5">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        {items.length > 0 && (
          <span className="text-sm text-muted-token tnum" data-testid="actions-summary">
            {summary.total}
            {summary.urgent && (
              <>
                {' · '}
                <span className="font-semibold text-urgent">{summary.urgent}</span>
              </>
            )}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="border-t border-line-soft py-3" data-testid="actions-none">
          <StatusDot tone="done">{none}</StatusDot>
        </div>
      ) : (
        <ul className="lg:grid lg:grid-cols-2 lg:gap-x-6">
          {items.map((a) => {
            const Icon = ICON[a.key]
            return (
              <li key={a.key} className="border-t border-line-soft">
                <Link
                  href={a.href}
                  className="-mx-1 flex min-h-14 items-center gap-3 rounded-md px-1 py-2 transition-colors duration-100 hover:bg-surface-2"
                  data-testid="action-chip"
                  data-key={a.key}
                  data-count={a.count}
                  data-tone={a.tone}
                >
                  <span className={`flex size-9.5 shrink-0 items-center justify-center rounded-[11px] ${BOX[a.tone]}`} aria-hidden>
                    <Icon className="size-4.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-semibold leading-snug text-ink">{labels[a.key]}</span>
                    <span className="truncate text-xs text-muted-token">{a.branch ? `${a.branch} · ${hints[a.key]}` : hints[a.key]}</span>
                  </span>
                  <span className={`text-[22px] font-bold tnum ${COUNT[a.tone]}`}>{a.count}</span>
                  <ChevronRight className="size-4.5 shrink-0 text-muted-token" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
