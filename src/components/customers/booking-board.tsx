'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Crown, Wine } from 'lucide-react'
import type { BadgeTone } from '@/components/ui/badge'
import { EmptyTab } from '@/components/deposit/empty-tab'
import type { BookingStatus } from '@/lib/booking/format'
import { BOARD_FILTERS, inBoardFilter, type Board, type BoardFilter, type BoardTile } from '@/lib/customers/smart'
import { addDays, formatLongDate, type AppLocale } from '@/lib/date'

/** The tonight page's tones for a booking: waiting amber, confirmed blue, here green, no-show red. */
const TONE: Record<BookingStatus, BadgeTone> = {
  pending: 'progress',
  confirmed: 'info',
  arrived: 'done',
  no_show: 'urgent',
  cancelled: 'pending',
  rejected: 'pending',
}

const FILTER_KEY: Record<BoardFilter, string> = {
  live: 'boardAll',
  pending: 'boardPending',
  confirmed: 'boardConfirmed',
  arrived: 'boardArrived',
  no_show: 'boardNoShow',
  cancelled: 'boardCancelled',
}

/**
 * A night's bookings as tiles (R-049) — what BK-0925, BK-0925-001, จองวันนี้ and จองพรุ่งนี้ bring
 * up on the customers page and on the scan page (R-052). A row of states narrows them. On the
 * customers page a tile opens the customer who booked; on the scan page (`onSelect`) it opens the
 * booking itself, ready to check in.
 */
export function BookingBoard({
  board,
  code,
  seq,
  tonight,
  locale,
  onSelect,
}: {
  board: Board
  code: string
  seq: string | null
  tonight: string
  locale: AppLocale
  onSelect?: (tile: BoardTile) => void
}) {
  const t = useTranslations('customers')
  const ts = useTranslations('status')
  const [filter, setFilter] = useState<BoardFilter>('live')
  const count = (f: BoardFilter) => board.rows.filter((r) => inBoardFilter(r.status, f)).length
  const rows = board.rows.filter((r) => inBoardFilter(r.status, filter))
  const title =
    board.night === tonight ? t('boardToday') : board.night === addDays(tonight, 1) ? t('boardTomorrow') : t('boardNight', { date: formatLongDate(board.night, locale) })

  return (
    <section data-testid="booking-board" data-night={board.night}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <span className="text-sm text-muted-token tnum">
          {seq ? t('boardCode', { code: `${code}-${seq}` }) : t('boardSub', { count: count('live'), arrived: count('arrived') })}
        </span>
      </div>

      <div role="group" aria-label={t('boardStates')} className="tabs mb-3" data-testid="board-filters">
        {BOARD_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`tab ${filter === f ? 'on' : ''}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            data-testid={`board-filter-${f}`}
          >
            {t(FILTER_KEY[f])}
            <span className="c">{count(f)}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyTab title={seq ? t('boardNoCode', { code: `${code}-${seq}` }) : t('boardEmpty')} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" data-testid="booking-tiles">
          {rows.map((r) => (
            <Tile key={r.id} tile={r} status={ts(`booking.${r.status}`)} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  )
}

function Tile({ tile, status, onSelect }: { tile: BoardTile; status: string; onSelect?: (tile: BoardTile) => void }) {
  const t = useTranslations('customers')
  const body = (
    <>
      <span className="top">
        <span className={`tbl ${tile.table ? '' : 'none'}`}>{tile.table ?? t('noTable')}</span>
        {tile.is_vip && (
          <span className="vip" title={t('vip')} data-testid="tile-vip">
            <Crown className="size-3.5" aria-hidden />
          </span>
        )}
      </span>
      <span className="nm">{tile.name}</span>
      <span className="meta num">{t('tileMeta', { time: tile.time, count: tile.party })}</span>
      <span className="foot">
        <span className="st">
          <i aria-hidden />
          <span className="truncate">{status}</span>
        </span>
        {tile.bottles > 0 && (
          <span className="bt" title={t('tileBottles', { count: tile.bottles })} data-testid="tile-bottles">
            <Wine className="size-3.5" aria-hidden />
            {tile.bottles}
          </span>
        )}
      </span>
    </>
  )
  const data = { 'data-tone': TONE[tile.status], 'data-status': tile.status, 'data-code': tile.code, 'data-testid': 'booking-tile' }
  return onSelect ? (
    <button type="button" className="btile text-left" onClick={() => onSelect(tile)} {...data}>
      {body}
    </button>
  ) : (
    <Link href={`/customers/${tile.key ?? `b-${tile.id}`}`} className="btile" {...data}>
      {body}
    </Link>
  )
}
