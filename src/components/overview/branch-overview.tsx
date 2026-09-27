import type { ReactNode } from 'react'
import Link from 'next/link'
import { BarChart3, CalendarDays, Check, TriangleAlert, Wine, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Translator } from '@/lib/deposit/format'
import { formatShortDate, weekdayIndex, type AppLocale } from '@/lib/date'
import { branchHref, type DashBranch } from '@/lib/reports/dashboard-view'

const PRINTER_KEY: Record<DashBranch['printer'], string> = { online: 'health.printerOnline', offline: 'health.printerOffline', not_set_up: 'health.printerNotSetUp' }

type Ctx = { t: Translator; tc: Translator; weekdays: string[]; locale: AppLocale; working: string | null }

/** The setup, on one line: each part a short name with a tick or a cross; the full wording for screen readers and on hover. */
function Health({ b, t }: { b: DashBranch; t: Translator }) {
  const lineOk = b.line_oa && b.liff
  const parts = [
    { id: 'health-printer', state: b.printer, ok: b.printer === 'online', bad: b.printer === 'offline', short: t('health.printerShort'), full: t(PRINTER_KEY[b.printer]) },
    { id: 'health-line', state: lineOk ? 'ready' : 'missing', ok: lineOk, bad: false, short: 'LINE', full: t(lineOk ? 'health.lineReady' : 'health.lineMissing') },
    { id: 'health-group', state: b.staff_group ? 'bound' : 'missing', ok: b.staff_group, bad: false, short: t('health.groupShort'), full: t(b.staff_group ? 'health.groupBound' : 'health.groupMissing') },
  ]
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="branch-health">
      {parts.map((h) => {
        const Icon = h.ok ? Check : h.bad ? TriangleAlert : X
        return (
          <li key={h.id} className={`flex items-center gap-1 ${h.ok ? 'text-ink-2' : h.bad ? 'font-semibold text-urgent' : 'text-muted-token'}`} title={h.full} data-testid={h.id} data-state={h.state}>
            <Icon className={`size-3.5 ${h.ok ? 'text-status-done' : ''}`} strokeWidth={2.5} aria-hidden />
            <span aria-hidden>{h.short}</span>
            <span className="sr-only">{h.full}</span>
          </li>
        )
      })}
    </ul>
  )
}

type Tile = { label: string; value: string | number; count: number; tone?: 'progress' | 'urgent' | 'done'; href?: string; testId?: string }
const TILE_TONE = { progress: 'text-status-progress', urgent: 'text-urgent', done: 'text-status-done' } as const

/** A row of figures: label on top, the number under it — coloured only when it asks for something, a link when there is a list behind it. */
function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
      {tiles.map((x) => {
        const body = (
          <>
            <span className="text-[11px] leading-tight text-muted-token">{x.label}</span>
            <span className={`self-center py-1 text-center text-xl font-bold leading-tight tnum ${x.count > 0 && x.tone ? TILE_TONE[x.tone] : x.count > 0 ? 'text-ink' : 'text-muted-token'}`}>{x.value}</span>
          </>
        )
        const cls = 'flex min-w-0 flex-col justify-between gap-1 bg-card px-2.5 py-2'
        return x.href && x.count > 0 ? (
          <Link key={x.label} href={x.href} className={`${cls} transition-colors duration-100 hover:bg-surface-2`} data-testid={x.testId}>
            {body}
          </Link>
        ) : (
          <div key={x.label} className={cls} data-testid={x.testId}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

function SectionHead({ icon: Icon, label, aside }: { icon: typeof Wine; label: string; aside?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <Icon className="size-3.5 text-muted-token" aria-hidden />
        {label}
      </span>
      {aside}
    </div>
  )
}

/** The last 7 business nights: bottles deposited (gold) next to bottles withdrawn (blue), the week's totals on top, each bar its number. */
function NightBars({ b, ctx }: { b: DashBranch; ctx: Ctx }) {
  const max = Math.max(1, ...b.nights.flatMap((n) => [n.in, n.out]))
  const sumIn = b.nights.reduce((n, x) => n + x.in, 0)
  const sumOut = b.nights.reduce((n, x) => n + x.out, 0)
  return (
    <div data-testid="branch-nights">
      <SectionHead
        icon={BarChart3}
        label={ctx.t('nightsTitle')}
        aside={
          <span className="flex items-center gap-2.5 text-xs text-ink-2 tnum">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-xs bg-accent" aria-hidden />
              {ctx.t('nightsIn')} {sumIn}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-xs bg-status-info" aria-hidden />
              {ctx.t('nightsOut')} {sumOut}
            </span>
          </span>
        }
      />
      <ol className="flex h-20 items-end gap-1.5">
        {b.nights.map((n) => {
          const label = ctx.t('nightBar', { date: formatShortDate(n.night, ctx.locale), in: n.in, out: n.out })
          return (
            <li key={n.night} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" title={label} data-night={n.night} data-in={n.in} data-out={n.out}>
              <div className="flex h-full w-full items-end justify-center gap-px" aria-hidden>
                {[
                  { v: n.in, cls: 'bg-accent' },
                  { v: n.out, cls: 'bg-status-info' },
                ].map((bar, i) => (
                  <span key={i} className="flex h-full w-1/2 max-w-3 flex-col items-center justify-end">
                    {bar.v > 0 && <span className="text-[9px] leading-tight text-ink-2 tnum">{bar.v}</span>}
                    <span className={`w-full rounded-t-xs ${bar.cls}`} style={{ height: `${bar.v ? Math.max(6, (bar.v / max) * 78) : 0}%` }} />
                  </span>
                ))}
              </div>
              <span className="border-t border-line-soft pt-0.5 text-[10px] leading-none text-muted-token">{ctx.weekdays[weekdayIndex(n.night)]}</span>
              <span className="sr-only">{label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * Phone and ≤ 3 branches (redesigned 2026-09-27): the name and its setup on one line each, then
 * three groups — เหล้าฝาก, จองคืนนี้ (row 1 liquor, row 2 bookings — owner request), 7 คืนล่าสุด —
 * each a row of figures that colour and link only when they ask for something.
 */
function BranchCard({ b, ctx }: { b: DashBranch; ctx: Ctx }) {
  const { t, tc } = ctx
  const go = (path: string) => branchHref(b.id, path, ctx.working)
  return (
    <article
      className="panel flex flex-col gap-4 p-4"
      data-testid="overview-branch-card"
      data-branch={b.code}
      data-in-store={b.in_store_bottles}
      data-to-confirm={b.to_confirm}
      data-expiring={b.expiring}
      data-to-dispose={b.to_dispose}
      data-bookings-tonight={b.bookings_tonight}
      data-arrived-tonight={b.arrived_tonight}
    >
      <header className="flex flex-col gap-1.5">
        <h3 className="text-base font-bold text-ink">{b.name}</h3>
        <Health b={b} t={t} />
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <section data-testid="overview-card-liquor">
          <SectionHead icon={Wine} label={t('groupLiquor')} />
          <Tiles
            tiles={[
              { label: t('colInStore'), value: b.in_store_bottles, count: b.in_store_bottles, href: go('/deposits') },
              { label: t('colToConfirm'), value: b.to_confirm, count: b.to_confirm, tone: 'progress', href: go('/deposits?tab=toConfirm') },
              { label: t('colExpiring'), value: b.expiring, count: b.expiring, tone: 'progress' },
              { label: t('colToDispose'), value: b.to_dispose, count: b.to_dispose, tone: 'urgent', href: go('/deposits?tab=expired') },
            ]}
          />
        </section>
        <section data-testid="overview-card-bookings">
          <SectionHead icon={CalendarDays} label={t('colBookingsTonight')} />
          <Tiles
            tiles={[
              { label: t('tileBooked'), value: tc('tables', { count: b.bookings_tonight }), count: b.bookings_tonight, href: go('/bookings') },
              { label: t('colArrived'), value: b.arrived_tonight, count: b.arrived_tonight, tone: 'done' },
              { label: t('colBookingsPending'), value: b.bookings_pending, count: b.bookings_pending, tone: 'progress', href: go(`/bookings?night=${b.bookings_pending_night ?? ''}&view=list`) },
            ]}
          />
        </section>
      </div>
      <NightBars b={b} ctx={ctx} />
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
