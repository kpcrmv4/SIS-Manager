/**
 * Where to go after login. Decided by a URL parser against our own origin,
 * never by a string prefix test: `//evil.example`, `/\evil.example` and
 * `/%09/evil.example` all start with "/" and all leave the site.
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string' || next.length > 512) return fallback
  const base = 'http://sis.invalid'
  let url: URL
  try {
    url = new URL(next, base)
  } catch {
    return fallback
  }
  if (url.origin !== base) return fallback
  if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return fallback
  if (url.pathname === '/login' || url.pathname.startsWith('/api/')) return fallback
  return url.pathname + url.search
}
