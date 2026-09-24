/**
 * Where "back" goes (R-050). A detail page's back button returns to the page the user came from —
 * the scan page, tonight, a deposit — not to a fixed parent list. Client-only: every function
 * reads the browser, and nothing here runs on the server.
 *
 * The browser's own list of entries (the Navigation API) says exactly where each step back lands;
 * the first entry back with a different path is the page before (a filter or a pager changes the
 * query, not the page). Where the API is missing, a trail of paths kept in sessionStorage stands in:
 * a path that equals the one before the last is a step back, anything else a step forward.
 */

type NavEntry = { url: string | null; index: number }
type NavApi = {
  currentEntry: NavEntry | null
  entries: () => NavEntry[]
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: (type: string, cb: () => void) => void
}

const KEY = 'sis:trail'
const listeners = new Set<() => void>()

const navApi = (): NavApi | null => {
  const nav = (window as Window & { navigation?: NavApi }).navigation
  return nav && typeof nav.entries === 'function' && nav.currentEntry ? nav : null
}

/** A page of the staff app — never the login, the customer LIFF or an API route. */
const staffPage = (path: string) => !/^\/(login|liff|api)(\/|$)/.test(path)

function readTrail(): string[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

function writeTrail(trail: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(trail.slice(-30)))
  } catch {
    // private mode / blocked storage: the button falls back to its parent page
  }
}

/** A customer page opened by its deposit or booking (d- / b-) redirects at once: never a page to return to. */
const passingThrough = (path: string) => /^\/customers\/[bd]-/.test(path)

/** Called by <NavTrail/> whenever the path changes. */
export function recordPath(path: string) {
  if (passingThrough(path)) return
  const trail = readTrail()
  if (trail[trail.length - 1] === path) return
  if (trail[trail.length - 2] === path) trail.pop()
  else trail.push(path)
  writeTrail(trail)
  listeners.forEach((l) => l())
}

export function subscribeTrail(cb: () => void): () => void {
  listeners.add(cb)
  const nav = navApi()
  nav?.addEventListener('currententrychange', cb)
  return () => {
    listeners.delete(cb)
    nav?.removeEventListener('currententrychange', cb)
  }
}

/**
 * The page before `current`, as "path|steps" (a string, so React can compare snapshots), or '' when
 * there is none — this page was opened directly, from a notification or a new tab.
 */
export function backSnapshot(current: string): string {
  const nav = navApi()
  if (nav?.currentEntry?.url) {
    const here = new URL(nav.currentEntry.url)
    // mid-navigation the address bar still shows the page being left: that one is the way back
    if (here.pathname !== current) return staffPage(here.pathname) ? `${here.pathname}|1` : ''
    const entries = nav.entries()
    for (let j = nav.currentEntry.index - 1; j >= 0; j--) {
      const url = entries[j]?.url
      if (!url) return ''
      const u = new URL(url)
      if (u.origin !== here.origin) return ''
      if (u.pathname !== current) return staffPage(u.pathname) ? `${u.pathname}|${nav.currentEntry.index - j}` : ''
    }
    return ''
  }
  const trail = readTrail()
  const n = trail.length
  // the trail is recorded after the page renders: allow for it being one step behind
  const before = trail[n - 1] === current ? trail[n - 2] : trail[n - 2] === current ? trail[n - 3] : trail[n - 1]
  return before && before !== current && staffPage(before) ? `${before}|1` : ''
}

export function parseBack(snapshot: string): { path: string; steps: number } | null {
  if (!snapshot) return null
  const [path, steps] = snapshot.split('|')
  return { path, steps: Math.max(1, Number(steps) || 1) }
}

/** The catalog key (namespace `back`) that names a page on its back button. */
export function backKey(path: string): string {
  if (path === '/tonight') return 'tonight'
  if (path === '/overview') return 'overview'
  if (path === '/deposits') return 'deposits'
  if (path === '/deposits/new') return 'depositNew'
  if (path.startsWith('/deposits/')) return 'deposit'
  if (path === '/bookings') return 'bookings'
  if (path === '/scan') return 'scan'
  if (path === '/customers') return 'customers'
  if (path.startsWith('/customers/')) return 'customer'
  if (path === '/reports') return 'reports'
  if (path === '/audit') return 'audit'
  if (path.startsWith('/settings')) return 'settings'
  if (path === '/me') return 'me'
  if (path === '/manual') return 'manual'
  return 'previous'
}
