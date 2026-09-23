import Link from 'next/link'
import { CalendarDays, Wine } from 'lucide-react'
import { Badge, StatusDot, type BadgeTone } from '@/components/ui/badge'
import type { Translator } from '@/lib/deposit/format'
import { formatShortDate, weekdayIndex, type AppLocale } from '@/lib/date'
import { branchHref, type DashBranch } from '@/lib/reports/dashboard-view'

const PRINTER_TONE: Record<DashBranch['printer'], BadgeTone> = { online: 'done', offline: 'urgent', not_set_up: 'pending' }
const PRINTER_KEY: Record<DashBranch['printer'], string> = { online: 'health.printerOnline', offline: 'health.printerOffline', not_set_up: 'health.printerNotSetUp' }

type Ctx = { t: Translator; tc: Translator; weekdays: string[]; locale: AppLocale; working: string | null }

function Health({ b, t }: { b: DashBranch; t: Translator }) {
  const lineOk = b.line_oa && b.liff
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" data-testid="branch-health">
      <span data-testid="health-printer" data-state={b.printer}>
        <StatusDot tone={PRINTER_TONE[b.printer]}>{t(PRINTER_KEY[b.printer])}</StatusDot>
      </span>
      <span data-testid="health-line" data-state={lineOk ? 'ready' : 'missing'}>
        <StatusDot tone={lineOk ? 'done' : 'pending'}>{t(lineOk ? 'health.lineReady' : 'health.lineMissing')}</StatusDot>
      </span>
      <span data-testid="health-group" data-state={b.staff_group ? 'bound' : 'missing'}>
        <StatusDot tone={b.staff_group ? 'done' : 'pending'}>{t(b.staff_group ? 'health.groupBound' : 'health.groupMissing')}</StatusDot>
      </span>
    </div>
  )
}

/** The last 7 business nights: bottles deposited (gold) next to bottles withdrawn (blue). */
function NightBars({ b, ctx }: { b: DashBranch; ctx: Ctx }) {
  const max = Math.max(1, ...b.nights.flatMap((n) => [n.in, n.out]))
  return (
    <div className="w-full md:w-60" data-testid="branch-nights">
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-token">
        <span>{ctx.t('nightsTitle')}</span>
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-xs bg-accent" aria-hidden />
            {ctx.t('nightsIn')}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-xs bg-status-info" aria-hidden />
            {ctx.t('nightsOut')}
          </span>
        </span>
      </div>
      <ol className="flex h-16 items-end gap-1.5">
        {b.nights.map((n) => {
          const label = ctx.t('nightBar', { date: formatShortDate(n.night, ctx.locale), in: n.in, out: n.out })
          return (
            <li key={n.night} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" title={label} data-night={n.night} data-in={n.in} data-out={n.out}>
              <div className="flex h-full w-full items-end justify-center gap-px" aria-hidden>
                <span className="w-1/2 max-w-2.5 rounded-t-xs bg-accent" style={{ height: `${Math.max(n.in ? 6 : 0, (n.in / max) * 100)}%` }} />
                <span className="w-1/2 max-w-2.5 rounded-t-xs bg-status-info" style={{ height: `${Math.max(n.out ? 6 : 0, (n.out / max) * 100)}%` }} />
              </div>
              <span className="text-[10px] leading-none text-muted-token">{ctx.weekdays[weekdayIndex(n.night)]}</span>
              <span className="sr-only">{label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Phone and ≤ 3 branches: row 1 liquor, row 2 bookings (owner request), health on top, nights on the side. */
function BranchCard({ b, ctx }: { b: DashBranch; ctx: Ctx }) {
  const { t, tc } = ctx
  const go = (path: string) => branchHref(b.id, path, ctx.working)
  return (
    <article
      className="panel p-4"
      data-testid="overview-branch-card"
      data-branch={b.code}
      data-in-store={b.in_store_bottles}
      data-to-confirm={b.to_confirm}
      data-expiring={b.expiring}
      data-to-dispose={b.to_dispose}
      data-bookings-tonight={b.bookings_tonight}
      data-arrived-tonight={b.arrived_tonight}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-[15px] font-semibold text-ink">{b.name}</h3>
        <Health b={b} t={t} />
      </div>
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2.5 border-b border-line-soft pb-2.5" data-testid="overview-card-liquor">
            <Wine className="mt-0.5 size-4 flex-none text-muted-token" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm tnum">
              <span>
                {t('colInStore')} <b>{b.in_store_bottles}</b>
              </span>
              <span>
                {t('colExpiring')} <b>{b.expiring}</b>
              </span>
              {b.to_confirm > 0 && (
                <Link href={go('/deposits?tab=toConfirm')}>
                  <Badge tone="progress">{`${t('colToConfirm')} ${b.to_confirm}`}</Badge>
                </Link>
              )}
              {b.to_dispose > 0 && (
                <Link href={go('/deposits?tab=expired')}>
                  <Badge tone="urgent">{`${t('colToDispose')} ${b.to_dispose}`}</Badge>
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2.5 pt-2.5" data-testid="overview-card-bookings">
            <CalendarDays className="mt-0.5 size-4 flex-none text-muted-token" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm tnum">
              <span>
                {t('colBookingsTonight')} <b>{tc('tables', { count: b.bookings_tonight })}</b>
              </span>
              <span>
                {t('colArrived')} <b>{b.arrived_tonight}</b>
              </span>
              {b.bookings_pending > 0 && (
                <Link href={go(`/bookings?night=${b.bookings_pending_night ?? ''}&view=list`)}>
                  <Badge tone="progress">{`${t('colBookingsPending')} ${b.bookings_pending}`}</Badge>
                </Link>
              )}
            </div>
          </div>
        </div>
        <NightBars b={b} ctx={ctx} />
      </div>
    </article>
  )
}

function BranchTable({ branches, ctx }: { branches: DashBranch[]; ctx: Ctx }) {
  const { t, tc } = ctx
  return (
    <div className="panel hidden overflow-x-auto nav:block" data-testid="overview-branches-desktop">
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('colBranch')}</th>
            <th>{t('colHealth')}</th>
            <th>{t('colInStore')}</th>
            <th>{t('colToConfirm')}</th>
            <th>{t('colExpiring')}</th>
            <th>{t('colToDispose')}</th>
            <th>{t('colBookingsTonight')}</th>
            <th>{t('colBookingsPending')}</th>
            <th>{t('colArrived')}</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {branches.map((b) => (
            <tr key={b.id} data-testid="overview-branch-row" data-branch={b.code} data-in-store={b.in_store_bottles} data-to-confirm={b.to_confirm} data-to-dispose={b.to_dispose}>
              <td className="font-semibold">{b.name}</td>
              <td>
                <Health b={b} t={t} />
              </td>
              <td>{b.in_store_bottles}</td>
              <td>{b.to_confirm > 0 ? <Badge tone="progress">{b.to_confirm}</Badge> : 0}</td>
              <td>{b.expiring}</td>
              <td>{b.to_dispose > 0 ? <Badge tone="urgent">{b.to_dispose}</Badge> : 0}</td>
              <td>{tc('tables', { count: b.bookings_tonight })}</td>
              <td>{b.bookings_pending > 0 ? <Badge tone="progress">{b.bookings_pending}</Badge> : 0}</td>
              <td>{b.arrived_tonight}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** ≤ 3 branches: a card each (on every screen). More: a table from `nav:` up, the same cards below it. */
export function BranchOverview({ branches, ...ctx }: { branches: DashBranch[] } & Ctx) {
  const cards = branches.length <= 3
  return (
    <>
      {!cards && <BranchTable branches={branches} ctx={ctx} />}
      <div className={`grid gap-3 ${cards ? (branches.length > 1 ? 'xl:grid-cols-2' : '') : 'nav:hidden'}`} data-testid="overview-branches-cards">
        {branches.map((b) => (
          <BranchCard key={b.id} b={b} ctx={ctx} />
        ))}
      </div>
    </>
  )
}
