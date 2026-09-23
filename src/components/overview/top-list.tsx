import type { LucideIcon } from 'lucide-react'
import { Link2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'
import type { Translator } from '@/lib/deposit/format'
import { Block } from './block'

type Row = { name: string; deposits: number; bottles: number; linked?: boolean }

/** A ranked top-5 by bottles deposited in the period, each with a bar against the leader. */
export function TopList({ title, rows, t, icon, testId, className = '' }: { title: string; rows: Row[]; t: Translator; icon: LucideIcon; testId: string; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.bottles))
  return (
    <Block title={title} aside={t('topHint')} className={className} testId={testId}>
      {rows.length === 0 ? (
        <EmptyState icon={icon} message={t('topEmpty')} />
      ) : (
        <ol className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="min-w-0" data-testid="top-row" data-name={r.name} data-bottles={r.bottles}>
              <div className="flex items-baseline gap-2 text-sm">
                <span className="w-4 shrink-0 text-xs font-semibold text-muted-token tnum">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {r.name}
                  {r.linked && <Link2 className="ml-1 inline size-3.5 text-status-done" aria-label={t('lineLinked')} />}
                </span>
                <span className="shrink-0 font-semibold text-ink tnum">{t('bottles', { count: r.bottles })}</span>
              </div>
              <div className="ml-6 mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                  <div className={`h-full rounded-full ${i === 0 ? 'bg-accent' : 'bg-accent/45'}`} style={{ width: `${(r.bottles / max) * 100}%` }} />
                </div>
                <span className="shrink-0 text-[11px] text-muted-token tnum">{t('topDeposits', { count: r.deposits })}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Block>
  )
}
