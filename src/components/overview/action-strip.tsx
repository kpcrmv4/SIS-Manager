import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { CalendarClock, ClipboardCheck, GlassWater, Hourglass, ListChecks, MessageCircleWarning, MessageSquarePlus, Printer, Trash2 } from 'lucide-react'
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

const TONE: Record<ActionItem['tone'], string> = {
  progress: 'text-status-progress bg-status-progress-bg ring-status-progress-ring',
  urgent: 'text-urgent bg-urgent-bg ring-urgent-ring',
}

/** "ต้องจัดการ" — every waiting job across the branches in one line, each chip opening its list. */
export function ActionStrip({ title, none, items, labels }: { title: string; none: string; items: ActionItem[]; labels: Record<ActionKey, string> }) {
  return (
    <section aria-label={title} className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2.5 shadow-e1" data-testid="overview-actions">
      <span className="mr-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
        <ListChecks className="size-4 text-muted-token" aria-hidden />
        {title}
      </span>
      {items.length === 0 ? (
        <span data-testid="actions-none">
          <StatusDot tone="done">{none}</StatusDot>
        </span>
      ) : (
        items.map((a) => {
          const Icon = ICON[a.key]
          return (
            <Link
              key={a.key}
              href={a.href}
              className={`chip gap-1.5 py-1 pl-2 pr-2.5 transition-opacity duration-100 hover:opacity-80 ${TONE[a.tone]}`}
              data-testid="action-chip"
              data-key={a.key}
              data-count={a.count}
            >
              <Icon className="size-3.5" aria-hidden />
              <span>{labels[a.key]}</span>
              <span className="tnum font-bold">{a.count}</span>
            </Link>
          )
        })
      )}
    </section>
  )
}
