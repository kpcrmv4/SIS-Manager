import type { ReactNode } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { hrefWith } from './filter-href'
import type { SelectOption } from './filter-select'

/**
 * A filter header with four layers — and four SHAPES.
 *
 * The failure this file exists to prevent: every filter rendered as the same
 * dark chip. Kind, period, project and status then look like one undifferentiated
 * row of twelve buttons, and the user cannot tell which of them are mutually
 * exclusive, which are scopes and which is the thing that changes the list
 * below. Shape carries that meaning before any label is read:
 *
 *   kind (income/expense/all)  → segmented switch   2–3 options, exclusive, always visible
 *   period · project · person  → <select> + icon    many options, one active scope
 *   free text                  → input + button     typed, needs a submit
 *   status                     → underline tabs     attached to the list it filters
 *
 * The rule generalises: at most one layer may be chips, and it is the one with
 * the fewest, most-pressed options. Two chip rows in one header is the bug.
 *
 * LAYOUT: layers stack on a phone and never scroll sideways as a group — each
 * control is full-width at `sm` and below. The status tabs sit LAST and touch
 * the list, because they are the layer that re-reads the rows.
 */
export function FilterHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-col gap-3">{children}</div>
}

export function FilterRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:auto-cols-fr sm:grid-flow-col sm:items-center">
      {children}
    </div>
  )
}

/* -------------------------------------------------------------- segmented */
/**
 * Two or three exclusive options, all visible. Selected is INK — a filter is
 * never the brand colour (see list-toolbar.tsx for why the kit is strict here).
 * Each option is a framed `.tab` pill, like ผังโต๊ะ / รายการ — an unselected
 * option on a bare track read as plain text (owner, R-035).
 */
export function SegmentedFilter({
  basePath,
  params,
  name,
  value,
  options,
  label,
}: {
  basePath: string
  params: Record<string, string | undefined>
  name: string
  value: string
  options: readonly SelectOption[]
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="tabs">
      {options.map((o) => {
        const active = o.value === value
        return (
          <Link key={o.value} href={hrefWith(basePath, params, { [name]: o.value })} aria-current={active ? 'true' : undefined} className="tab">
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------- tabs */
/** Status lives on underline tabs attached to the list — not in the select row. */
export function UnderlineTabs({
  basePath,
  params,
  name,
  value,
  options,
  label,
}: {
  basePath: string
  params: Record<string, string | undefined>
  name: string
  value: string
  options: readonly (SelectOption & { count?: number })[]
  label: string
}) {
  return (
    <nav
      aria-label={label}
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 no-scrollbar"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <Link
            key={o.value}
            href={hrefWith(basePath, params, { [name]: o.value })}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-100 ${
              active
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className="ml-1.5 text-xs font-semibold tnum text-muted-token">{o.count}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

/* ----------------------------------------------------------------- search */
/**
 * Typing is the one layer that keeps its button: a navigation per keystroke is
 * a history entry per keystroke. `method="get"` means the query still lands in
 * the URL like every other layer.
 *
 * Hidden inputs carry the other layers — a search that silently resets the
 * period is the same bug hrefWith() exists to prevent, arriving through the
 * one control that cannot call it.
 */
export function SearchBox({
  basePath,
  params,
  q,
  name = 'q',
  placeholder = 'ค้นหา…',
  label = 'ค้นหา',
}: {
  basePath: string
  params: Record<string, string | undefined>
  q: string
  name?: string
  placeholder?: string
  label?: string
}) {
  return (
    <form action={basePath} method="get" className="flex min-w-0 gap-2">
      {Object.entries(params)
        .filter(([k, v]) => k !== name && k !== 'page' && v)
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
        <input
          type="search"
          name={name}
          defaultValue={q}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input-base w-full py-2 pl-8.5 text-sm"
        />
      </div>
      <button type="submit" className="btn-secondary shrink-0 px-3 py-2 text-sm">
        {label}
      </button>
    </form>
  )
}

/* ----------------------------------------------------------- known option */
/**
 * A filtered link outlives the options list.
 *
 * The URL says `?site=<id>` for a project that has since been closed, so it is
 * no longer in the dropdown — and a <select> whose value matches no <option>
 * renders BLANK. The filter is still applied; the control just stops admitting
 * it, and the page looks broken in a way nobody can describe ("it shows the
 * wrong rows and the box is empty").
 *
 * The page already fetched the row to show its name in the heading, so pass
 * that name here. Applies to any archived/inactive/deleted-but-referenced
 * entity: employees, categories, price lists.
 */
export function withKnownOption(
  options: readonly SelectOption[],
  value: string | undefined,
  label: string | undefined,
): SelectOption[] {
  if (!value || value === 'all' || options.some((o) => o.value === value)) return [...options]
  return [...options, { value, label: label ? `${label} (ปิดแล้ว)` : value }]
}
