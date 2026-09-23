'use client'

import { useRouter } from 'next/navigation'
import { CalendarDays, Warehouse, Tag, User, type LucideIcon } from 'lucide-react'
import { hrefWith, rangeDates, type RangeKey, type ParamValue } from './filter-href'

/**
 * The ONLY client component in the filter header.
 *
 * A <select> cannot be a <Link>, so this file exists — and nothing else moves
 * into it. Segmented switches, tabs and the search form stay server-rendered in
 * filter-bar.tsx ('use client' is a boundary, not a convenience: widening it to
 * cover the whole header drags the icon props and the row data into the bundle).
 *
 * NO "APPLY" BUTTON. Changing the select navigates. The user's model of a
 * filter is "I picked it, show me" — a second press to confirm a choice they
 * already made is the step everyone forgets, and then they report that the
 * filter does not work. The URL still holds the state (that is what
 * router.push writes), so Back, refresh and sharing all keep working.
 *
 * ICONS BY KEY, not by prop. A Server Component cannot hand a client one a
 * component reference (`icon={CalendarDays}` → "Only plain objects can be
 * passed…"), so the parent passes a string and the map lives here.
 */
const ICONS: Record<string, LucideIcon> = {
  calendar: CalendarDays,
  site: Warehouse,
  category: Tag,
  person: User,
}

export type SelectOption = { value: string; label: string }

export function FilterSelect({
  basePath,
  params,
  name,
  value,
  options,
  icon,
  label,
  patch,
}: {
  basePath: string
  params: Record<string, string | undefined>
  name: string
  value: string
  options: readonly SelectOption[]
  icon?: keyof typeof ICONS
  label: string
  /** extra keys to change alongside this one (e.g. clearing from/to) */
  patch?: (value: string) => Record<string, ParamValue>
}) {
  const router = useRouter()
  const Icon = icon ? ICONS[icon] : undefined

  return (
    <label className="relative inline-flex min-w-0 items-center">
      <span className="sr-only">{label}</span>
      {Icon && (
        <Icon className="pointer-events-none absolute left-2.5 size-4 text-muted-token" aria-hidden />
      )}
      <select
        name={name}
        value={value}
        aria-label={label}
        onChange={(e) =>
          router.push(
            hrefWith(basePath, params, { [name]: e.target.value, ...(patch?.(e.target.value) ?? {}) }),
          )
        }
        className={`input-base w-full appearance-none py-2 pr-8 text-sm ${Icon ? 'pl-8.5' : 'pl-3'}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Date range: presets + `custom`. Two date inputs appear only for `custom`,
 * because a header that always shows two empty date fields reads as a form to
 * fill in rather than a filter to press.
 *
 * `today` is passed in, never read from the browser: the server already knows
 * the Asia/Bangkok date, and letting the client decide re-introduces the
 * timezone drift the whole app spent effort removing ([nextjs-gotchas] §7).
 */
const RANGE_LABELS: Record<RangeKey, string> = {
  all: 'ทั้งหมด',
  today: 'วันนี้',
  month: 'เดือนนี้',
  last: 'เดือนที่แล้ว',
  year: 'ปีนี้',
  custom: 'กำหนดเอง',
}

export function RangeFilter({
  basePath,
  params,
  range,
  from,
  to,
  today,
}: {
  basePath: string
  params: Record<string, string | undefined>
  range: RangeKey
  from?: string
  to?: string
  today: string
}) {
  const router = useRouter()
  const go = (patch: Record<string, ParamValue>) => router.push(hrefWith(basePath, params, patch))

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <FilterSelect
        basePath={basePath}
        params={params}
        name="range"
        value={range}
        label="ช่วงเวลา"
        icon="calendar"
        options={(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => ({
          value: k,
          label: RANGE_LABELS[k],
        }))}
        // the preset writes the dates it means; `custom` keeps whatever is there
        patch={(v) => (v === 'custom' ? {} : rangeDates(v as RangeKey, today))}
      />

      {range === 'custom' && (
        <>
          <input
            type="date"
            value={from ?? ''}
            max={to ?? undefined}
            aria-label="ตั้งแต่วันที่"
            onChange={(e) => go({ from: e.target.value })}
            className="input-base py-2 text-sm"
          />
          <span className="text-muted-token">–</span>
          <input
            type="date"
            value={to ?? ''}
            min={from ?? undefined}
            aria-label="ถึงวันที่"
            onChange={(e) => go({ to: e.target.value })}
            className="input-base py-2 text-sm"
          />
        </>
      )}
    </div>
  )
}
