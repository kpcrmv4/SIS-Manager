'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Loader2, Search, X } from 'lucide-react'
import { hrefWith } from '@/components/ui/filter-href'

const DEBOUNCE_MS = 300
const flat = (v: string) => v.toUpperCase().replace(/[^0-9A-Z]/g, '')

/**
 * The customers page's search (R-049): results follow what is typed, no Enter needed — a booking
 * code brings up that night's bookings, a name or phone the customers. The shortcuts type the
 * code of tonight or tomorrow for you. The query lives in the address bar (replaced, not pushed),
 * so Back returns to the same results.
 */
export function SmartSearch({
  q,
  params,
  placeholder,
  searchLabel,
  clearLabel,
  shortcuts,
}: {
  q: string
  params: Record<string, string | undefined>
  placeholder: string
  searchLabel: string
  clearLabel: string
  shortcuts: { key: string; label: string; code: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState(q)
  // the q this box last put in the address bar, and the q the page last rendered with
  const [pushed, setPushed] = useState(q)
  const [seen, setSeen] = useState(q)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // the address bar moved without this box (a card, Back, a link): take its query
  if (q !== seen) {
    setSeen(q)
    if (q !== pushed) {
      setValue(q)
      setPushed(q)
    }
  }

  useEffect(() => {
    const t = timer
    return () => clearTimeout(t.current)
  }, [])

  function go(next: string) {
    clearTimeout(timer.current)
    const trimmed = next.trim()
    setPushed(trimmed)
    startTransition(() => {
      router.replace(hrefWith('/customers', params, { q: trimmed || null, page: null }), { scroll: false })
    })
  }

  function type(next: string) {
    setValue(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => go(next), DEBOUNCE_MS)
  }

  const typed = flat(value)
  return (
    <div className="flex flex-col gap-2.5">
      <form
        role="search"
        className="flex min-w-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          go(value)
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-token" aria-hidden />
          <input
            type="search"
            value={value}
            onChange={(e) => type(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            autoComplete="off"
            enterKeyHint="search"
            className="input-base w-full py-2 pl-8.5 pr-9 text-sm [&::-webkit-search-cancel-button]:hidden"
            data-testid="customers-search"
          />
          {pending ? (
            <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-token" aria-hidden />
          ) : (
            value && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-token hover:bg-surface-2"
                aria-label={clearLabel}
                onClick={() => {
                  setValue('')
                  go('')
                }}
                data-testid="customers-search-clear"
              >
                <X className="size-4" aria-hidden />
              </button>
            )
          )}
        </div>
        <button type="submit" className="btn-secondary shrink-0 px-3 py-2 text-sm">
          {searchLabel}
        </button>
      </form>
      <div className="tabs" data-testid="customers-shortcuts">
        {shortcuts.map((s) => {
          const on = typed.startsWith(flat(s.code))
          return (
            <button
              key={s.key}
              type="button"
              className={`tab inline-flex items-center gap-1.5 ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => {
                setValue(s.code)
                go(s.code)
              }}
              data-testid={`customers-shortcut-${s.key}`}
            >
              <CalendarClock className="size-3.5" aria-hidden />
              {s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
