import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { History } from 'lucide-react'
import { AuditList, type AuditText } from '@/components/audit/audit-list'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { getActorState } from '@/lib/auth/actor'
import { eventText } from '@/lib/deposit/format'
import { addDays, bangkokDate, formatShortDate } from '@/lib/date'
import { getSupabaseServer } from '@/lib/supabase/server'
import { AUDIT_KINDS, AUDIT_PAGE, formatValue, isAuditKind, isDepositEvent, latest, type AuditFeed, type AuditRow, type ValueFormat } from '@/lib/audit/view'

type Search = Promise<{ from?: string; to?: string; kind?: string; branch?: string; actor?: string; q?: string; page?: string }>

const YMD = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SPAN_DAYS = 366
const SECRET_NAME: Record<string, string> = { channel_access_token: 'Channel access token', channel_secret: 'Channel secret' }

/**
 * บันทึกการใช้งาน (R-038, owner only): who did what and when across the branches, filtered by
 * kind of work, period, branch, person and a search on code or name. Rows come from audit_feed.
 */
export default async function AuditPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const today = bangkokDate()
  const from = sp.from && YMD.test(sp.from) ? sp.from : addDays(today, -6)
  const to = sp.to && YMD.test(sp.to) ? sp.to : today
  const kind = isAuditKind(sp.kind) ? sp.kind : null
  const branchId = sp.branch && UUID.test(sp.branch) ? sp.branch : null
  const actor = sp.actor === 'customer' || sp.actor === 'system' || (sp.actor && UUID.test(sp.actor)) ? sp.actor : null
  const q = (sp.q ?? '').trim().slice(0, 60)
  const page = Math.max(1, Math.trunc(Number(sp.page) || 1))
  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
  const badRange = to < from ? 'badRange' : spanDays > MAX_SPAN_DAYS ? 'rangeTooLong' : null

  const sb = await getSupabaseServer()
  const [t, tRoot, state, branchesRes, peopleRes] = await Promise.all([
    getTranslations('audit'),
    getTranslations(),
    getActorState(),
    sb.from('branches').select('id, name').order('name').range(0, 199),
    sb.from('profiles').select('id, display_name, username').order('display_name').range(0, 499),
  ])
  const locale = state.status === 'ok' ? state.actor.locale : 'th'
  const branches = branchesRes.data ?? []
  const people = (peopleRes.data ?? []).filter((p) => !p.username?.startsWith('printer-'))
  const fmt = (ymd: string) => formatShortDate(`${ymd}T12:00:00+07:00`, locale)

  // every link keeps the other filters
  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams()
    const cur: Record<string, string | null> = { from, to, kind, branch: branchId, actor, q: q || null, ...patch }
    for (const [k, v] of Object.entries(cur)) if (v) params.set(k, v)
    return `/audit?${params}`
  }

  const header = <PageHeader title={t('title')} subtitle={t('subtitle', { from: fmt(from), to: fmt(to) })} />
  const ranges = [
    { key: 'today', label: t('rangeToday'), from: today, to: today },
    { key: '7', label: t('range7'), from: addDays(today, -6), to: today },
    { key: '30', label: t('range30'), from: addDays(today, -29), to: today },
  ]

  let feed: AuditFeed | null = null
  let failed = false
  if (!badRange) {
    const { data, error } = await sb.rpc('audit_feed', {
      p_from: `${from}T00:00:00+07:00`,
      p_to: `${addDays(to, 1)}T00:00:00+07:00`,
      p_category: kind ?? undefined,
      p_branch: branchId ?? undefined,
      p_actor: actor ?? undefined,
      p_q: q || undefined,
      p_limit: AUDIT_PAGE,
      p_offset: (page - 1) * AUDIT_PAGE,
    })
    if (error) failed = true
    else feed = data as unknown as AuditFeed
  }
  const counts = feed?.counts ?? {}
  const all = Object.values(counts).reduce((n, c) => n + (c ?? 0), 0)

  const filters = (
    <div className="mb-5 flex flex-col gap-3">
      <div role="group" aria-label={t('kindsLabel')} className="tabs flex-wrap" data-testid="audit-kinds">
        {[null, ...AUDIT_KINDS].map((k) => (
          <Link
            key={k ?? 'all'}
            href={href({ kind: k, page: null })}
            aria-current={kind === k ? 'true' : undefined}
            className="tab"
            data-kind={k ?? 'all'}
            data-count={k ? (counts[k] ?? 0) : all}
          >
            {t(`kinds.${k ?? 'all'}`)}
            <span className="c">{k ? (counts[k] ?? 0) : all}</span>
          </Link>
        ))}
      </div>
      <form method="get" className="card-surface p-4" data-testid="audit-filter">
        <div role="group" aria-label={t('rangeLabel')} className="tabs mb-3 flex-wrap" data-testid="audit-ranges">
          {ranges.map((r) => (
            <Link key={r.key} href={href({ from: r.from, to: r.to, page: null })} aria-current={r.from === from && r.to === to ? 'true' : undefined} className="tab" data-range={r.key}>
              {r.label}
            </Link>
          ))}
        </div>
        {kind && <input type="hidden" name="kind" value={kind} />}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_1.4fr_auto] md:items-end">
          <div>
            <label className="label-base" htmlFor="a-from">
              {t('from')}
            </label>
            <input id="a-from" name="from" type="date" className="input-base tnum" defaultValue={from} />
          </div>
          <div>
            <label className="label-base" htmlFor="a-to">
              {t('to')}
            </label>
            <input id="a-to" name="to" type="date" className="input-base tnum" defaultValue={to} />
          </div>
          <div>
            <label className="label-base" htmlFor="a-branch">
              {t('branch')}
            </label>
            <select id="a-branch" name="branch" className="input-base" defaultValue={branchId ?? ''}>
              <option value="">{t('allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-base" htmlFor="a-actor">
              {t('actor')}
            </label>
            <select id="a-actor" name="actor" className="input-base" defaultValue={actor ?? ''}>
              <option value="">{t('anyone')}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name || p.username}
                </option>
              ))}
              <option value="customer">{t('customer')}</option>
              <option value="system">{t('system')}</option>
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="label-base" htmlFor="a-q">
              {t('search')}
            </label>
            <input id="a-q" name="q" type="search" className="input-base" defaultValue={q} placeholder={t('searchPlaceholder')} maxLength={60} />
          </div>
          <button type="submit" className="btn-primary col-span-2 md:col-span-1" data-testid="audit-apply">
            {t('apply')}
          </button>
        </div>
      </form>
    </div>
  )

  if (badRange) {
    return (
      <>
        {header}
        {filters}
        <EmptyState message={t(badRange)} />
      </>
    )
  }
  if (failed || !feed) {
    return (
      <>
        {header}
        {filters}
        <RefreshRetry />
      </>
    )
  }

  const weekdays = tRoot.raw('settingsBooking.weekdays') as string[]
  const valueFormat: ValueFormat = {
    on: t('on'),
    off: t('off'),
    none: t('none'),
    weekday: (i) => weekdays[i] ?? String(i),
    date: fmt,
    label: (key, v) => {
      if (key === 'role' && ['staff', 'bar', 'owner'].includes(v)) return tRoot(`roles.${v}`)
      if (key === 'shape' && ['square', 'round', 'room'].includes(v)) return tRoot(`settingsTables.shape.${v}`)
      if (key === 'table_choice') return v === 'customer' ? tRoot('settingsBooking.tableChoiceCustomer') : v === 'shop' ? tRoot('settingsBooking.tableChoiceShop') : null
      if (key === 'status' && tRoot.has(`status.booking.${v}`)) return tRoot(`status.booking.${v}`)
      if (key === 'fields') return SECRET_NAME[v] ?? null
      return null
    },
  }
  const text: AuditText = {
    action: (row) =>
      isDepositEvent(row)
        ? eventText(tRoot, { action: row.action.slice('deposit.'.length), payload: row.details }, locale)
        : tRoot.has(`audit.action.${row.action}`)
          ? tRoot(`audit.action.${row.action}`)
          : row.action,
    subject: (row: AuditRow) => {
      const d = row.details
      if (isDepositEvent(row)) return [d.item, d.customer].filter(Boolean).join(' · ') || null
      if (row.category !== 'booking') return null
      const night = latest(d.night)
      return t('bookingLine', {
        name: String(latest(d.name) ?? ''),
        party: Number(latest(d.party)) || 0,
        date: typeof night === 'string' ? fmt(night) : '',
        time: String(latest(d.time) ?? ''),
      })
    },
    who: (row) => (row.actor_kind === 'customer' ? t('customer') : row.actor_kind === 'system' ? t('system') : (row.actor_name ?? t('unknownActor'))),
    role: (row) => (row.actor_kind === 'staff' && row.actor_role ? tRoot(`roles.${row.actor_role}`) : null),
    field: (key) =>
      key.startsWith('receipt_settings.')
        ? t('field.receipt', { key: key.slice('receipt_settings.'.length) })
        : t.has(`field.${key}`)
          ? t(`field.${key}`)
          : key,
    value: (key, v) => formatValue(key, v, valueFormat),
    details: t('details'),
  }

  const first = feed.total ? (page - 1) * AUDIT_PAGE + 1 : 0
  const last = Math.min(page * AUDIT_PAGE, feed.total)

  return (
    <>
      {header}
      {filters}
      {feed.rows.length === 0 ? (
        <EmptyState icon={History} message={t('empty')} />
      ) : (
        <>
          <AuditList rows={feed.rows} text={text} locale={locale} branchNames={Object.fromEntries(branches.map((b) => [b.id, b.name]))} showBranch={!branchId && branches.length > 1} />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-token">
            <span className="tnum" data-testid="audit-showing">
              {t('showing', { from: first, to: last, total: feed.total })}
            </span>
            <span className="flex gap-2">
              {page > 1 && (
                <Link href={href({ page: String(page - 1) })} className="btn-ghost btn-sm">
                  {t('prev')}
                </Link>
              )}
              {last < feed.total && (
                <Link href={href({ page: String(page + 1) })} className="btn-ghost btn-sm" data-testid="audit-next">
                  {t('next')}
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </>
  )
}
