import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { formatShortDate, formatTime, type AppLocale } from '@/lib/date'
import type { HistoryGroup, HistoryRow } from '@/lib/deposit/history'

export type HistoryText = { what: (r: HistoryRow) => string; who: (r: HistoryRow) => string; role: (r: HistoryRow) => string | null }

// the same hue as the matching filter card on /deposits (R-047)
const DOT: Record<HistoryGroup, string> = {
  deposit: 'bg-status-progress',
  withdraw: 'bg-status-violet',
  expiry: 'bg-urgent',
  other: 'bg-muted',
}

/** R-061 · the events: a table from `nav:` up, cards on a phone; each opens its deposit. */
export function HistoryList({ rows, text, locale, cols }: { rows: HistoryRow[]; text: HistoryText; locale: AppLocale; cols: { time: string; what: string; deposit: string; who: string } }) {
  const when = (r: HistoryRow) => `${formatShortDate(r.at, locale)} · ${formatTime(r.at, locale)}`
  return (
    <>
      <div className="panel hidden overflow-x-auto nav:block" data-testid="history-table">
        <table className="tbl">
          <thead>
            <tr>
              <th>{cols.time}</th>
              <th>{cols.what}</th>
              <th>{cols.deposit}</th>
              <th>{cols.who}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="history-row" data-action={r.action} data-group={r.group}>
                <td className="num whitespace-nowrap text-muted-token">{when(r)}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className={`size-2 flex-none rounded-full ${DOT[r.group]}`} aria-hidden />
                    {text.what(r)}
                  </span>
                </td>
                <td>
                  <Link href={`/deposits/${r.deposit_id}`} className="hover:underline">
                    <span className="code">{r.code}</span>
                    <span className="block text-xs text-muted-token">
                      {r.customer} · {r.item}
                    </span>
                  </Link>
                </td>
                <td>
                  {text.who(r)}
                  {text.role(r) && <span className="ml-1 text-xs text-muted-token">{text.role(r)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="panel nav:hidden" data-testid="history-cards">
        {rows.map((r) => (
          <li key={r.id} className="border-b border-line-soft last:border-b-0">
            <Link href={`/deposits/${r.deposit_id}`} className="flex items-center gap-3 px-4 py-3" data-testid="history-row" data-action={r.action} data-group={r.group}>
              <span className={`size-2 flex-none rounded-full ${DOT[r.group]}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">{text.what(r)}</span>
                <span className="block truncate text-sm text-ink-2">
                  <span className="code">{r.code}</span> · {r.customer} · {r.item}
                </span>
                <span className="block text-xs text-muted-token tnum">
                  {when(r)} · {text.who(r)}
                  {text.role(r) && ` (${text.role(r)})`}
                </span>
              </span>
              <ChevronRight className="size-4 flex-none text-muted-token" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
