'use client'

import { useTranslations } from 'next-intl'
import { Check, Lock } from 'lucide-react'

export type PlanTable = {
  id: string
  label: string
  shape: 'square' | 'round' | 'room'
  seats_min: number
  seats_max: number
  state: 'free' | 'taken' | 'blocked'
}
export type PlanZone = { id: string; name: string; tables: PlanTable[] }

/** A free table the party fits is the only thing a customer can pick. */
export const fitsParty = (x: PlanTable, party: number) => party >= x.seats_min && party <= x.seats_max

/**
 * "เลือกโต๊ะ" (R-036): the night's floor plan, zone by zone. A free table that fits the party is a
 * tap target; a taken, closed or too-small table says why it cannot be picked. Never who holds it.
 */
export function TablePlan({
  zones,
  party,
  selected,
  onSelect,
}: {
  zones: PlanZone[]
  party: number
  selected: string | null
  onSelect: (table: PlanTable, zone: PlanZone) => void
}) {
  const t = useTranslations('cx')
  const shown = zones.filter((z) => z.tables.length > 0)
  const anyFree = shown.some((z) => z.tables.some((x) => x.state === 'free' && fitsParty(x, party)))
  const seats = (x: PlanTable) => (x.seats_min === x.seats_max ? t('book.tableSeatsOne', { count: x.seats_max }) : t('book.tableSeats', { min: x.seats_min, max: x.seats_max }))

  return (
    <div className="flex flex-col gap-3" data-testid="cx-table-plan">
      <div className="cx-legend" aria-hidden>
        <span>
          <i />
          {t('book.tableFree')}
        </span>
        <span>
          <i className="picked" />
          {t('book.tablePicked')}
        </span>
        <span>
          <i className="off" />
          {t('book.tableTaken')}
        </span>
        <span>
          <i className="off" />
          {t('book.tableBlocked')}
        </span>
      </div>
      {!anyFree && (
        <p className="cx-card text-center text-sm text-cx-muted" data-testid="cx-table-none">
          {t('book.tableNone', { count: party })}
        </p>
      )}
      {shown.map((z) => (
        <section key={z.id} aria-label={z.name}>
          <h3 className="cx-zone-name">{z.name}</h3>
          <div className="cx-plan">
            {z.tables.map((x) => {
              const state = x.state !== 'free' ? x.state : fitsParty(x, party) ? 'free' : 'small'
              const on = selected === x.id
              const why = state === 'taken' ? t('book.tableTaken') : state === 'blocked' ? t('book.tableBlocked') : state === 'small' ? t('book.tableSmall', { count: party }) : seats(x)
              return (
                <button
                  key={x.id}
                  type="button"
                  className={`cx-tbl ${x.shape} ${state}`}
                  aria-pressed={on}
                  aria-label={`${x.label} · ${why}`}
                  title={why}
                  disabled={state !== 'free'}
                  onClick={() => onSelect(x, z)}
                  data-testid="cx-table"
                  data-label={x.label}
                  data-state={state}
                >
                  {on && <Check className="ok" aria-hidden />}
                  {state === 'blocked' && <Lock className="ok" aria-hidden />}
                  <b>{x.label}</b>
                  <span>{state === 'taken' || state === 'blocked' ? why : seats(x)}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
