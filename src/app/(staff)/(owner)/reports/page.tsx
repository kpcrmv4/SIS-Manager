import { getTranslations } from 'next-intl/server'
import { Download, FileText } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { ListRow } from '@/components/ui/list-row'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getActorState } from '@/lib/auth/actor'
import { formatShortDate } from '@/lib/date'
import { getReport, isYmd, periodRange, reportTotals, REPORT_TOTAL_KEYS, showRate, type ReportBranch } from '@/lib/reports/overview'

type Search = Promise<{ from?: string; to?: string; branch?: string }>

const COL_KEY: Record<(typeof REPORT_TOTAL_KEYS)[number], string> = {
  deposits_new: 'colNewDeposits',
  bottles_new: 'colBottlesNew',
  withdrawals: 'colWithdrawals',
  bottles_withdrawn: 'colBottlesWithdrawn',
  expired: 'colExpired',
  disposed: 'colDisposed',
  bookings: 'colBookings',
  arrived: 'colArrived',
  no_shows: 'colNoShows',
  cancelled: 'colCancelled',
}

/** P4-01: per-branch summary for any Bangkok date range, plus Excel / PDF export. */
export default async function ReportsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const month = periodRange('month')
  const from = isYmd(sp.from) ? sp.from : month.from
  const to = isYmd(sp.to) ? sp.to : month.to
  const branchId = sp.branch && sp.branch !== 'all' ? sp.branch : null

  const sb = await getSupabaseServer()
  const [t, state, branchesRes] = await Promise.all([
    getTranslations('reports'),
    getActorState(),
    sb.from('branches').select('id, name').order('name').range(0, 199),
  ])
  if (branchesRes.error) throw new Error(`reports branches: ${branchesRes.error.code}`)
  const locale = state.status === 'ok' ? state.actor.locale : 'th'
  const badRange = to < from
  const report = badRange ? { from, to, branches: [] as ReportBranch[] } : await getReport(from, to, branchId)
  const totals = reportTotals(report.branches)
  const q = new URLSearchParams({ from, to, ...(branchId ? { branch: branchId } : {}) }).toString()

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('rangeSubtitle', { from: formatShortDate(`${from}T12:00:00+07:00`, locale), to: formatShortDate(`${to}T12:00:00+07:00`, locale) })}
        action={
          !badRange && (
            <>
              <a className="btn-ghost" href={`/api/reports/export?format=xlsx&${q}`} data-testid="reports-export-xlsx">
                <Download className="size-4" aria-hidden />
                {t('exportExcel')}
              </a>
              <a className="btn-ghost" href={`/api/reports/export?format=pdf&${q}`} data-testid="reports-export-pdf">
                <FileText className="size-4" aria-hidden />
                {t('exportPdf')}
              </a>
            </>
          )
        }
      />

      <form method="get" className="card-surface mb-5 grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" data-testid="reports-filter">
        <div>
          <label className="label-base" htmlFor="r-from">
            {t('from')}
          </label>
          <input id="r-from" name="from" type="date" className="input-base tnum" defaultValue={from} />
        </div>
        <div>
          <label className="label-base" htmlFor="r-to">
            {t('to')}
          </label>
          <input id="r-to" name="to" type="date" className="input-base tnum" defaultValue={to} />
        </div>
        <div>
          <label className="label-base" htmlFor="r-branch">
            {t('branch')}
          </label>
          <select id="r-branch" name="branch" className="input-base" defaultValue={branchId ?? 'all'}>
            <option value="all">{t('allBranches')}</option>
            {(branchesRes.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary" data-testid="reports-apply">
          {t('apply')}
        </button>
      </form>

      {badRange ? (
        <EmptyState message={t('badRange')} />
      ) : report.branches.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <>
          <div className="panel hidden overflow-x-auto nav:block" data-testid="reports-table-desktop">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('branch')}</th>
                  {REPORT_TOTAL_KEYS.map((k) => (
                    <th key={k}>{t(COL_KEY[k])}</th>
                  ))}
                  <th>{t('colShowRate')}</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {report.branches.map((b) => (
                  <tr key={b.id} data-testid="reports-row" data-branch={b.code}>
                    <td className="font-semibold">{b.name}</td>
                    {REPORT_TOTAL_KEYS.map((k) => (
                      <td key={k} data-col={k}>
                        {b[k]}
                      </td>
                    ))}
                    <td>{rateText(b.arrived, b.no_shows)}</td>
                  </tr>
                ))}
                {report.branches.length > 1 && (
                  <tr className="font-semibold" data-testid="reports-total">
                    <td>{t('total')}</td>
                    {REPORT_TOTAL_KEYS.map((k) => (
                      <td key={k} data-col={k}>
                        {totals[k]}
                      </td>
                    ))}
                    <td>{rateText(totals.arrived, totals.no_shows)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="panel nav:hidden" data-testid="reports-cards-mobile">
            {report.branches.map((b) => (
              <ListRow
                key={b.id}
                title={b.name}
                meta={
                  <span className="tnum">
                    {REPORT_TOTAL_KEYS.map((k) => `${t(COL_KEY[k])} ${b[k]}`).join(' · ')} · {t('colShowRate')} {rateText(b.arrived, b.no_shows)}
                  </span>
                }
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}

function rateText(arrived: number, noShows: number) {
  const r = showRate(arrived, noShows)
  return r === null ? '—' : `${r}%`
}
