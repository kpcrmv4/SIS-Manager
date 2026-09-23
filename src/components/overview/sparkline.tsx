import { SPARK_H, SPARK_PAD, SPARK_W, sparkGeometry } from '@/lib/reports/spark'

/**
 * An 8-point trend line in plain SVG (no chart library). The figure above it is the number
 * that matters; the line only shows direction, so its scale starts at zero and the label reads
 * the values for screen readers.
 */

export type SparkTone = 'default' | 'done' | 'urgent' | 'info' | 'progress'

const STROKE: Record<SparkTone, string> = {
  default: 'text-ink-2',
  done: 'text-status-done',
  urgent: 'text-urgent',
  info: 'text-status-info',
  progress: 'text-status-progress',
}

export function Sparkline({ values, tone = 'default', label, max }: { values: (number | null)[]; tone?: SparkTone; label: string; max?: number }) {
  const g = sparkGeometry(values, max)
  const flat = values.every((v) => !v)
  return (
    <div className={`relative mt-2 h-7 w-full ${STROKE[tone]}`} role="img" aria-label={label} data-testid="sparkline" data-values={values.map((v) => v ?? '').join(',')}>
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        {flat ? (
          <line x1={SPARK_PAD} x2={SPARK_W - SPARK_PAD} y1={SPARK_H - SPARK_PAD} y2={SPARK_H - SPARK_PAD} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        ) : (
          <>
            {g.area && <path d={g.area} fill="currentColor" fillOpacity={0.09} />}
            <path d={g.line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {!flat && g.last && (
        // an HTML dot, not an SVG circle: the stretched viewBox would turn a circle into an ellipse
        <span
          aria-hidden
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-card"
          style={{ left: `${(g.last.x / SPARK_W) * 100}%`, top: `${(g.last.y / SPARK_H) * 100}%` }}
        />
      )}
    </div>
  )
}
