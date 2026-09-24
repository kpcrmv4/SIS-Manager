/**
 * Keep a page's open thing in its address (R-050) — the scan result, the booking sheet — so that
 * coming Back to the page shows it again. Rewrites the query of the current history entry without
 * a navigation; Next.js keeps useSearchParams in step with window.history.replaceState.
 * Client-only.
 */
export function replaceQuery(patch: Record<string, string | null>) {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(patch)) {
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A uuid from the address, or null — an id is never trusted further than its shape here. */
export const uuidParam = (value: string | null | undefined): string | null => (value && UUID.test(value) ? value : null)
