import { UserRound } from 'lucide-react'
import type { Translator } from '@/lib/deposit/format'
import type { ReportStaff } from '@/lib/reports/report-view'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { Block } from '@/components/overview/block'

/** Who did the work in the period: deposits received, bottles confirmed, withdrawals handed over, check-ins. */
export function ReportStaffList({ staff, t, tRoles, className = '' }: { staff: ReportStaff[]; t: Translator; tRoles: Translator; className?: string }) {
  const max = Math.max(1, ...staff.map((s) => s.total))
  return (
    <Block title={t('staffTitle')} aside={t('staffHint')} className={className} testId="report-staff">
      {staff.length === 0 ? (
        <EmptyState icon={UserRound} message={t('staffEmpty')} />
      ) : (
        <ol className="flex flex-col gap-3">
          {staff.map((s) => (
            <li key={`${s.name}-${s.role}`} className="min-w-0" data-testid="report-staff-row" data-name={s.name} data-total={s.total}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{s.name}</span>
                <Badge tone={s.role === 'owner' ? 'brand' : s.role === 'bar' ? 'gold' : 'info'}>{tRoles(s.role)}</Badge>
                <span className="w-8 shrink-0 text-right text-sm font-semibold text-ink tnum">{s.total}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                <div className="h-full rounded-full bg-brand/70" style={{ width: `${(s.total / max) * 100}%` }} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-token tnum">
                {s.received > 0 && <span>{t('staffReceived', { count: s.received })}</span>}
                {s.confirmed > 0 && <span>{t('staffConfirmed', { count: s.confirmed })}</span>}
                {s.withdrawals > 0 && <span>{t('staffWithdrawals', { count: s.withdrawals })}</span>}
                {s.check_ins > 0 && <span>{t('staffCheckIns', { count: s.check_ins })}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Block>
  )
}
