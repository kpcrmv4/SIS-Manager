/**
 * ONE function builds every filter URL on the page. Pure, no 'use client', so
 * Server Components, Links and the client <select>s all call the same thing.
 *
 * Why one function and not a URLSearchParams at each call site: a filter header
 * with four layers has a dozen places that build a href, and each one has to
 * remember to CARRY the other three. The day someone forgets, choosing a month
 * silently resets the project filter — and it looks like a data bug, not a
 * missing query param, because the page did re-render with different rows.
 *
 *   hrefWith(base, sp, { status: 'pending' })   // keep everything else
 *   hrefWith(base, sp, { q: null })             // remove one key
 *   hrefWith(base, sp, { site: id, page: null })// change one, reset paging
 *
 * RULES ENCODED HERE:
 *  - null / '' / 'all' remove the key, so the clean URL is the default view and
 *    `?status=all` never competes with `` for the same page in the cache;
 *  - any patch touching a filter drops `page`, because page 3 of a different
 *    filter is an empty screen the user has to diagnose;
 *  - key order is stable (sorted), so two ways of reaching the same view
 *    produce the same string — which is what makes `href === current` usable
 *    for aria-current and what keeps the browser cache from splitting.
 */
export type ParamValue = string | number | null | undefined

const DROPS_PAGE = new Set(['q', 'status', 'kind', 'range', 'from', 'to'])

export function hrefWith(
  basePath: string,
  current: URLSearchParams | Record<string, string | undefined>,
  patch: Record<string, ParamValue>,
  opts: { pageKey?: string; resetsPage?: (key: string) => boolean } = {},
): string {
  const { pageKey = 'page', resetsPage = (k) => DROPS_PAGE.has(k) } = opts
  const next = new URLSearchParams(
    current instanceof URLSearchParams
      ? current
      : Object.entries(current).filter((e): e is [string, string] => e[1] != null),
  )

  for (const [key, raw] of Object.entries(patch)) {
    const value = raw == null ? '' : String(raw)
    if (value === '' || value === 'all') next.delete(key)
    else next.set(key, value)
    if (resetsPage(key)) next.delete(pageKey)
  }

  next.sort()
  const qs = next.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

/* ------------------------------------------------------------------ ranges */
/**
 * A date filter is ONE control with presets plus `custom`, not two date inputs
 * that most users never touch. `custom` is the escape hatch; the presets are
 * what gets pressed.
 *
 * Both directions live here on purpose. rangeDates() turns the choice into the
 * two dates the query needs; detectRange() turns two dates back into the choice
 * so a shared link opens with "เดือนนี้" selected instead of falling through to
 * "กำหนดเอง" — the same round trip the URL-as-state rule depends on.
 */
export type RangeKey = 'all' | 'today' | 'month' | 'last' | 'year' | 'custom'

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** `today` is the caller's today — pass the Asia/Bangkok date, never new Date() on Vercel. */
export function rangeDates(key: RangeKey, today: string): { from?: string; to?: string } {
  const t = new Date(`${today}T00:00:00Z`)
  const y = t.getUTCFullYear()
  const m = t.getUTCMonth()
  switch (key) {
    case 'today':
      return { from: today, to: today }
    case 'month':
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) }
    case 'last':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }
    case 'year':
      return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(new Date(Date.UTC(y, 11, 31))) }
    default:
      return {}
  }
}

export function detectRange(from: string | undefined, to: string | undefined, today: string): RangeKey {
  if (!from && !to) return 'all'
  for (const key of ['today', 'month', 'last', 'year'] as const) {
    const r = rangeDates(key, today)
    if (r.from === from && r.to === to) return key
  }
  return 'custom'
}
