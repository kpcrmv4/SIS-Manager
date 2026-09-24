import type { LucideIcon } from 'lucide-react'
import type { Delta } from '@/lib/reports/dashboard-view'
import { DeltaChip } from '@/components/overview/delta-chip'

export type ReportFigure = {
  key: string
  label: string
  value: string
  delta: Delta
  good: 'up' | 'down' | 'none'
  deltaText: string | null
  hint: string
  tone?: 'default' | 'urgent' | 'done'
}

const TONE = { default: 'text-ink', urgent: 'text-urgent', done: 'text-status-done' } as const

/** One group of the period's figures (ฝากเหล้า / จองโต๊ะ), each against the previous period. */
export function ReportFigures({ title, icon: Icon, figures, compareTitle, testId }: { title: string; icon: LucideIcon; figures: ReportFigure[]; compareTitle: string; testId: string }) {
  return (
    <section aria-label={title} className="panel p-4" data-testid={testId}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon className="size-4 text-muted-token" aria-hidden />
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {figures.map((f) => (
          <div key={f.key} className="min-w-0 rounded-md border border-line-soft bg-surface px-3 py-2.5" data-testid="report-figure" data-key={f.key} data-value={f.value}>
            <div className="truncate text-xs text-muted-token">{f.label}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`text-2xl font-bold tracking-tight tnum ${TONE[f.tone ?? 'default']}`}>{f.value}</span>
              <DeltaChip delta={f.delta} good={f.good} text={f.deltaText} title={compareTitle} kpi={f.key} />
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-token tnum">{f.hint}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
