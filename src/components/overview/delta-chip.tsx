import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { Delta } from '@/lib/reports/dashboard-view'

/**
 * The change of a figure against the previous period. Green when it moved the good way, red
 * when the bad way, grey when the direction means nothing (withdrawals) or nothing changed.
 */
export function DeltaChip({
  delta,
  good,
  text,
  title,
  kpi,
}: {
  delta: Delta
  /** which way is good news: up, down, or none (neutral) */
  good: 'up' | 'down' | 'none'
  text: string | null
  /** what it is compared with — tooltip and screen-reader text */
  title: string
  /** data-kpi, for the specs */
  kpi: string
}) {
  if (!delta || !text) return null
  const verdict = good === 'none' || delta.dir === 'same' ? 'neutral' : delta.dir === good ? 'good' : 'bad'
  const cls =
    verdict === 'good'
      ? 'text-status-done bg-status-done-bg ring-status-done-ring'
      : verdict === 'bad'
        ? 'text-urgent bg-urgent-bg ring-urgent-ring'
        : 'text-ink-2 bg-surface-2 ring-line'
  const Icon = delta.dir === 'up' ? ArrowUpRight : delta.dir === 'down' ? ArrowDownRight : Minus
  return (
    <span className={`chip shrink-0 gap-0.5 px-1.5 ${cls}`} title={title} data-testid="kpi-delta" data-kpi={kpi} data-dir={delta.dir} data-verdict={verdict}>
      <Icon className="size-3" aria-hidden />
      <span className="tnum">{text}</span>
      <span className="sr-only"> {title}</span>
    </span>
  )
}
