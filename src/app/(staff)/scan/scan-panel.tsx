'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, Info, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Scanner } from '@/components/scan/scanner'
import { ScanResultBooking } from '@/components/booking/scan-result-booking'
import { ScanResultDeposit } from '@/components/deposit/scan-result-deposit'
import { BookingBoard } from '@/components/customers/booking-board'
import { ErrorRetry } from '@/components/ui/error-retry'
import { lookupBoard, lookupScan, type BoardLookup, type ScanHit } from '@/lib/scan/actions'
import { shortcutCodes } from '@/lib/customers/smart'
import type { AppLocale } from '@/lib/date'
import { replaceQuery, uuidParam } from '@/lib/url-state'

const DEBOUNCE_MS = 300
const bookingCode = (q: string) => /^\s*bk/i.test(q)
const flat = (v: string) => v.toUpperCase().replace(/[^0-9A-Z]/g, '')

/**
 * Scan or type → one lookup → the deposit or booking result slot (filled by workers A and B).
 * A booking code typed here (R-052) — BK-0925, on to BK-0925-001 — brings up that night's bookings
 * as tiles as you type, like the จองวันนี้ / จองพรุ่งนี้ shortcuts; a tile opens its booking, ready
 * to check in, and ปิด goes back to the tiles. What is open stays in the address (?q= the tiles,
 * ?b= booking · ?d= deposit, R-050), so Back from a page opened here shows it again.
 */
export function ScanPanel({ branchId, tonight }: { branchId: string; tonight: string }) {
  const t = useTranslations('scan')
  const tc = useTranslations('common')
  const tk = useTranslations('customers')
  const locale = useLocale() as AppLocale
  const sp = useSearchParams()
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [hit, setHit] = useState<ScanHit | null>(() => {
    const booking = uuidParam(sp.get('b'))
    const deposit = uuidParam(sp.get('d'))
    return booking ? { kind: 'booking', id: booking } : deposit ? { kind: 'deposit', id: deposit } : null
  })
  const [missed, setMissed] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [board, setBoard] = useState<BoardLookup | null>(null)
  const [boardPending, startBoard] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const boardRef = useRef<HTMLDivElement>(null)
  const codes = shortcutCodes(tonight)

  const show = (next: ScanHit | null) => {
    setHit(next)
    replaceQuery({ b: next?.kind === 'booking' ? next.id : null, d: next?.kind === 'deposit' ? next.id : null })
  }

  /** Fetch the tiles for a booking code; the code goes into the address so Back returns to them. */
  function fetchBoard(raw: string, scroll = false) {
    const q = raw.trim()
    replaceQuery({ q: q || null })
    startBoard(async () => {
      let r: BoardLookup
      try {
        r = await lookupBoard(branchId, q)
      } catch {
        r = { kind: 'error' }
      }
      setBoard(r)
      if (scroll && r.kind === 'board') requestAnimationFrame(() => boardRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    })
  }

  // tiles asked for before (Back from a booking's customer page): bring them back
  useEffect(() => {
    const q = sp.get('q') ?? ''
    if (bookingCode(q)) fetchBoard(q)
    const t = timer
    return () => clearTimeout(t.current)
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function type(next: string) {
    setQuery(next)
    setMissed(null)
    clearTimeout(timer.current)
    if (bookingCode(next)) {
      timer.current = setTimeout(() => fetchBoard(next), DEBOUNCE_MS)
    } else {
      setBoard(null)
      replaceQuery({ q: null })
    }
  }

  function pick(code: string) {
    clearTimeout(timer.current)
    setQuery(code)
    setMissed(null)
    show(null)
    fetchBoard(code, true)
  }

  function resolve(raw: string) {
    const q = raw.trim()
    if (!q) return
    clearTimeout(timer.current)
    setMissed(null)
    if (bookingCode(q)) fetchBoard(q)
    start(async () => {
      let r: ScanHit
      try {
        r = await lookupScan(branchId, q)
      } catch {
        r = { kind: 'error' }
      }
      if (r.kind === 'error') {
        show(null)
        toast.error(tc('errorTitle'), { action: { label: tc('retry'), onClick: () => resolve(q) } })
        return
      }
      // a code that is only a date (BK-0925) finds no single booking: the tiles answer it
      if (r.kind === 'none' && bookingCode(q)) return
      show(r.kind === 'none' ? null : r)
      if (r.kind === 'none') setMissed(q)
    })
  }

  // ปิด on a result: back to the tiles it was picked from (fresh — it may have just checked in), or to an empty box
  const reset = () => {
    show(null)
    if (bookingCode(query)) {
      fetchBoard(query)
    } else {
      setQuery('')
      replaceQuery({ q: null })
    }
  }

  const typed = flat(query)
  const shortcuts = [
    { key: 'today', label: tk('shortcutToday'), code: codes.today },
    { key: 'tomorrow', label: tk('shortcutTomorrow'), code: codes.tomorrow },
  ]

  return (
    <div className="mx-auto max-w-105 nav:max-w-none">
      <div className="mx-auto max-w-105">
        <Scanner onCode={resolve} paused={pending || hit !== null} />
        <div className="orline">{t('or')}</div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            resolve(query)
          }}
          className="flex flex-col gap-2.5"
        >
          <label className="flex items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2">
            <Search className="size-4 text-muted-token" aria-hidden />
            <input
              value={query}
              onChange={(e) => type(e.target.value)}
              placeholder={t('placeholder')}
              aria-label={t('placeholder')}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent outline-none"
              data-testid="scan-input"
            />
            {boardPending && <Loader2 className="size-4 animate-spin text-muted-token" aria-hidden />}
          </label>
          <button type="submit" className="btn-primary w-full" disabled={pending || !query.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('submit')}
          </button>
        </form>
        <div className="tabs mt-2.5" data-testid="scan-shortcuts">
          {shortcuts.map((s) => {
            const on = typed.startsWith(flat(s.code))
            return (
              <button
                key={s.key}
                type="button"
                className={`tab inline-flex items-center gap-1.5 ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => pick(s.code)}
                data-testid={`scan-shortcut-${s.key}`}
              >
                <CalendarClock className="size-3.5" aria-hidden />
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 scroll-mt-4" aria-live="polite" ref={boardRef}>
        {hit ? (
          <div className="mx-auto max-w-105">
            {hit.kind === 'deposit' && <ScanResultDeposit depositId={hit.id} onDone={reset} />}
            {hit.kind === 'booking' && <ScanResultBooking bookingId={hit.id} branchId={branchId} onDone={reset} />}
          </div>
        ) : missed && !pending ? (
          <p className="mx-auto max-w-105 rounded-md bg-status-progress-bg px-3 py-2 text-sm text-status-progress" role="status">
            {t('notFound', { q: missed })}
          </p>
        ) : board?.kind === 'board' ? (
          <BookingBoard
            key={`${board.board.night}:${board.seq ?? ''}`}
            board={board.board}
            code={board.code}
            seq={board.seq}
            tonight={board.tonight}
            locale={locale}
            onSelect={(tile) => show({ kind: 'booking', id: tile.id })}
          />
        ) : board?.kind === 'hint' ? (
          <p className="panel mx-auto flex max-w-105 items-start gap-2 px-4 py-3 text-sm text-ink-2" data-testid="scan-hint">
            <Info className="mt-0.5 size-4 flex-none text-status-info" aria-hidden />
            {tk(board.reason === 'date' ? 'hintDate' : 'hintBadDate', { example: codes.tomorrow })}
          </p>
        ) : board?.kind === 'error' ? (
          <ErrorRetry onRetry={() => fetchBoard(query)} />
        ) : null}
      </div>
    </div>
  )
}
