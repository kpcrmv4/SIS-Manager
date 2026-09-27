import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Delta } from '@/lib/reports/dashboard-view'
import { DeltaChip } from './delta-chip'

/**
 * The owner's figures (redesigned 2026-09-27): one panel, three blocks, each drawn from what it
 * means — the bottles in store split by branch, the period's in and out with their change against
 * the previous period (only when that period had any), and the show rate split into who came, who
 * did not and the rest. No decorative trend lines.
 */

export type Segment = { key: string; label: string; value: number; color: string }
export type FlowFigure = {
  key: string
  label: string
  value: number
  unit?: string
  sub: string
  subUrgent?: boolean
  tone: 'brand' | 'info' | 'urgent'
  delta: Delta
  good: 'up' | 'down' | 'none'
  deltaText: string | null
  deltaTitle: string
  href: string
}

const VALUE_TONE: Record<FlowFigure['tone'], string> = { brand: 'text-brand', info: 'text-status-info', urgent: 'text-urgent' }

/** A stacked bar with a legend below; widths follow the values, a 2px gap between parts. */
function Split({ parts, testId }: { parts: Segment[]; testId: string }) {
  const shown = parts.filter((p) => p.value > 0)
  if (!shown.length) return null
  return (
    <>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-md" aria-hidden data-testid={testId}>
        {shown.map((p) => (
          <span key={p.key} style={{ flex: `${p.value} 1 0`, background: p.color }} data-key={p.key} data-value={p.value} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-2 tnum">
        {parts.map((p) => (
          <li key={p.key} className="flex min-w-0 items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: p.color }} aria-hidden />
            <span className="truncate">{p.label}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function Head({ label, aside }: { label: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] font-medium text-muted-token">{label}</span>
      {aside && <span className="truncate text-xs text-muted-token tnum">{aside}</span>}
    </div>
  )
}

export function FiguresPanel({
  stock,
  flow,
  rate,
}: {
  stock: { label: string; value: number; unit: string; hint: string; prev: ReactNode | null; branches: Segment[]; href: string }
  flow: { label: string; range: string; figures: FlowFigure[] }
  rate: { label: string; value: string; booked: string; delta: Delta; deltaText: string | null; deltaTitle: string; parts: Segment[]; href: string }
}) {
  return (
    <section className="mb-5 overflow-hidden rounded-lg border border-line bg-card shadow-e1 lg:grid lg:grid-cols-[1fr_1.4fr_1fr]" data-testid="overview-kpis">
      <Link href={stock.href} className="flex flex-col gap-2.5 px-4 pb-4 pt-3.5 transition-colors duration-100 hover:bg-surface-2" data-testid="kpi-cell" data-kpi="in_store">
        <Head label={stock.label} aside={stock.prev} />
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-[44px] font-bold leading-none tracking-tight text-ink tnum" data-testid="kpi-value" data-kpi="in_store">
            {stock.value}
          </span>
          <span className="text-[15px] text-muted-token">{stock.unit}</span>
          <span className="ml-auto text-[13px] text-ink-2 tnum">{stock.hint}</span>
        </div>
        {stock.branches.length > 1 && <Split parts={stock.branches} testId="stock-split" />}
      </Link>

      <div className="flex flex-col gap-3 border-t border-line-soft px-4 pb-4 pt-3.5 lg:border-l lg:border-t-0">
        <Head label={flow.label} aside={flow.range} />
        <div className="grid grid-cols-3 gap-3">
          {flow.figures.map((f) => (
            <Link key={f.key} href={f.href} className="-m-1.5 flex min-w-0 flex-col gap-0.5 rounded-md p-1.5 transition-colors duration-100 hover:bg-surface-2" data-testid="kpi-cell" data-kpi={f.key}>
              <span className="truncate text-xs text-muted-token">{f.label}</span>
              <span className={`text-[28px] font-bold leading-tight ${VALUE_TONE[f.tone]}`}>
                <span className="tnum" data-testid="kpi-value" data-kpi={f.key}>
                  {f.value}
                </span>
                {f.unit && <span className="ml-1 text-[13px] font-normal text-muted-token">{f.unit}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <DeltaChip delta={f.delta} good={f.good} text={f.deltaText} title={f.deltaTitle} kpi={f.key} />
                <span className={`truncate text-[11px] tnum ${f.subUrgent ? 'text-urgent' : 'text-muted-token'}`}>{f.sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <Link href={rate.href} className="flex flex-col gap-2.5 border-t border-line-soft px-4 pb-4 pt-3.5 transition-colors duration-100 hover:bg-surface-2 lg:border-l lg:border-t-0" data-testid="kpi-cell" data-kpi="show_rate">
        <Head label={rate.label} aside={rate.booked} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[34px] font-bold leading-none tracking-tight text-ink tnum" data-testid="kpi-value" data-kpi="show_rate">
            {rate.value}
          </span>
          <DeltaChip delta={rate.delta} good="up" text={rate.deltaText} title={rate.deltaTitle} kpi="show_rate" />
        </div>
        <Split parts={rate.parts} testId="rate-split" />
      </Link>
    </section>
  )
}
