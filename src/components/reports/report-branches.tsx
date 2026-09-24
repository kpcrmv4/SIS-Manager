import type { Translator } from '@/lib/deposit/format'
import { ListRow } from '@/components/ui/list-row'
import { REPORT_TOTAL_KEYS, reportTotals, showRate, type ReportBranch } from '@/lib/reports/overview'

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

function rateText(arrived: number, noShows: number) {
  const r = showRate(arrived, noShows)
  return r === null ? '—' : `${r}%`
}

/** Per-branch summary of the period: a table from `nav:` up (with a total row), one row each below it. */
export function ReportBranches({ branches, t }: { branches: ReportBranch[]; t: Translator }) {
  const totals = reportTotals(branches)
  return (
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
            {branches.map((b) => (
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
            {branches.length > 1 && (
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
        {branches.map((b) => (
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
  )
}
