import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { Delta } from '@/lib/reports/dashboard-view'
import { Sparkline, type SparkTone } from './sparkline'

export type KpiCell = {
  key: string
  label: string
  icon: LucideIcon
  value: string
  unit?: string
  hint?: string
  tone: SparkTone
  delta: Delta
  /** which way is good news: more deposits (up), fewer disposals (down), withdrawals (none) */
  good: 'up' | 'down' | 'none'
  deltaText: string | null
  deltaTitle: string
  series: (number | null)[]
  seriesLabel: string
  seriesMax?: number
  href?: string
}

const VALUE_TONE: Record<SparkTone, string> = {
  default: 'text-ink',
  urgent: 'text-urgent',
  progress: 'text-status-progress',
  done: 'text-status-done',
  info: 'text-status-info',
}

function DeltaChip({ c }: { c: KpiCell }) {
  if (!c.delta || !c.deltaText) return null
  const verdict = c.good === 'none' || c.delta.dir === 'same' ? 'neutral' : c.delta.dir === c.good ? 'good' : 'bad'
  const cls =
    verdict === 'good'
      ? 'text-status-done bg-status-done-bg ring-status-done-ring'
      : verdict === 'bad'
        ? 'text-urgent bg-urgent-bg ring-urgent-ring'
        : 'text-ink-2 bg-surface-2 ring-line'
  const Icon = c.delta.dir === 'up' ? ArrowUpRight : c.delta.dir === 'down' ? ArrowDownRight : Minus
  return (
    <span className={`chip shrink-0 gap-0.5 px-1.5 ${cls}`} title={c.deltaTitle} data-testid="kpi-delta" data-kpi={c.key} data-dir={c.delta.dir} data-verdict={verdict}>
      <Icon className="size-3" aria-hidden />
      <span className="tnum">{c.deltaText}</span>
      <span className="sr-only"> {c.deltaTitle}</span>
    </span>
  )
}

/**
 * The figure strip, one panel divided by hairlines (the kit's MetricBar rule: one instrument,
 * not five floating cards). Each figure carries its change against the previous period and an
 * 8-week line; a figure that counts rows links to where those rows are.
 */
export function KpiStrip({ cells }: { cells: KpiCell[] }) {
  const n = cells.length
  return (
    <section className="mb-5 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface shadow-e1 lg:grid-cols-5" data-testid="overview-kpis">
      {cells.map((c, i) => {
        const lastRow = i === n - 1 && n % 2 === 1
        const cls = [
          'group min-w-0 border-line-soft px-4 pb-2.5 pt-3',
          lastRow ? 'col-span-2 lg:col-span-1' : 'border-b lg:border-b-0',
          !lastRow && i % 2 === 0 ? 'border-r' : '',
          i < n - 1 ? 'lg:border-r' : 'lg:border-r-0',
        ].join(' ')
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-token">
              <c.icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="truncate">{c.label}</span>
            </span>
            {/* the change sits beside the number it qualifies, so a phone-width label never truncates for it */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`text-3xl font-bold tracking-tight ${VALUE_TONE[c.tone]}`}>
                <span className="tnum" data-testid="kpi-value" data-kpi={c.key}>
                  {c.value}
                </span>
                {c.unit && <span className="ml-1 text-sm font-normal tracking-normal text-muted-token">{c.unit}</span>}
              </span>
              <DeltaChip c={c} />
            </div>
            {c.hint && <div className="mt-0.5 truncate text-xs text-muted-token">{c.hint}</div>}
            <Sparkline values={c.series} tone={c.tone} label={c.seriesLabel} max={c.seriesMax} />
          </>
        )
        return c.href ? (
          <Link key={c.key} href={c.href} className={`${cls} transition-colors duration-100 hover:bg-surface-2`} data-testid="kpi-cell" data-kpi={c.key}>
            {body}
          </Link>
        ) : (
          <div key={c.key} className={cls} data-testid="kpi-cell" data-kpi={c.key}>
            {body}
          </div>
        )
      })}
    </section>
  )
}
