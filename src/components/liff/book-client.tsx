'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Armchair, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { addDays, bangkokDate, weekdayIndex } from '@/lib/date'
import { CxErrorRetry, CxSkeleton } from './cx-states'
import { errorText } from './error-text'
import { customerFetch, useCxSession } from './session-context'
import { TablePlan, type PlanZone } from './table-plan'

type Night = { night: string; closed: boolean; reason: string | null; slots: string[] }
type Zone = { id: string; name: string }
type Availability = {
  line_enabled: boolean
  party_min: number
  party_max: number
  nights: Night[]
  zones: Zone[]
  inStoreDeposits: number
  /** 'customer': the customer picks a table on the plan instead of a zone (R-036) */
  tableChoice: 'shop' | 'customer'
}
type Pick = { id: string; label: string; zone: string; min: number; max: number }

const DAYS_SHOWN = 14
// the picked table is no longer the customer's to take — show the plan again
const TABLE_GONE = new Set(['table_taken', 'table_not_bookable', 'table_seats', 'BAD_TABLE'])

/** "จองโต๊ะ" (P2-C3): date strip → slot grid → party stepper → zone chips → form → create_booking. */
export function BookClient() {
  const t = useTranslations('cx')
  const router = useRouter()
  const session = useCxSession()

  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [data, setData] = useState<Availability | null>(null)
  const [nightIdx, setNightIdx] = useState(0)
  const [slot, setSlot] = useState<string | null>(null)
  const [party, setParty] = useState(2)
  const [zoneId, setZoneId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [plan, setPlan] = useState<PlanZone[] | null>(null)
  const [planState, setPlanState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [pick, setPick] = useState<Pick | null>(null)
  const planSeq = useRef(0)

  // only the newest request may set state: a late answer from an earlier one (dev double-run
  // effect, a retry) would otherwise reset the slot the customer has just picked
  const loadSeq = useRef(0)
  const load = useCallback(() => {
    const seq = ++loadSeq.current
    setState('loading')
    const from = bangkokDate()
    const to = addDays(from, DAYS_SHOWN - 1)
    customerFetch(`/api/customer/availability?branch=${session.branch.code}&from=${from}&to=${to}`, session)
      .then((res) => {
        if (!res.ok) throw new Error('load failed')
        return res.json() as Promise<Availability>
      })
      .then((d) => {
        if (seq !== loadSeq.current) return
        setData(d)
        setParty(Math.min(Math.max(2, d.party_min), d.party_max))
        const firstOpen = d.nights.findIndex((n) => !n.closed)
        setNightIdx(firstOpen >= 0 ? firstOpen : 0)
        setSlot(null)
        setState('ready')
      })
      .catch(() => {
        if (seq === loadSeq.current) setState('error')
      })
  }, [session])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  // the floor plan of the chosen night; a late answer for an earlier night is dropped
  const loadPlan = useCallback(
    (night: string) => {
      const seq = ++planSeq.current
      setPlanState('loading')
      customerFetch(`/api/customer/tables?branch=${session.branch.code}&night=${night}`, session)
        .then((res) => {
          if (!res.ok) throw new Error('plan failed')
          return res.json() as Promise<{ zones: PlanZone[] }>
        })
        .then((d) => {
          if (seq !== planSeq.current) return
          setPlan(d.zones)
          setPlanState('ready')
        })
        .catch(() => {
          if (seq === planSeq.current) setPlanState('error')
        })
    },
    [session],
  )
  const customerPicks = data?.tableChoice === 'customer'
  const planNight = data && data.nights[nightIdx] && !data.nights[nightIdx].closed ? data.nights[nightIdx].night : null
  useEffect(() => {
    if (!customerPicks || !planNight) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPlan(planNight)
  }, [customerPicks, planNight, loadPlan])

  if (state === 'loading') return <CxSkeleton rows={3} />
  if (state === 'error' || !data) return <CxErrorRetry message={t('shell.errorGeneric')} onRetry={load} />

  if (!data.line_enabled) return <CxErrorRetry message={t('book.lineDisabled')} onRetry={load} />

  const night = data.nights[nightIdx]
  const weekdays = t.raw('book.weekdays') as string[]

  // a picked table that no longer fits the party is unpicked (the plan dims it)
  const changeParty = (next: number) => {
    setParty(next)
    if (pick && (next < pick.min || next > pick.max)) setPick(null)
  }

  const submit = async () => {
    if (!night || night.closed || !slot) return
    const cleanName = name.trim()
    if (!cleanName) {
      toast.error(errorText(t, 'name_required'))
      return
    }
    if (customerPicks && !pick) {
      toast.error(errorText(t, 'table_required'))
      return
    }
    setPending(true)
    try {
      const res = await customerFetch(`/api/customer/bookings?branch=${session.branch.code}`, session, {
        method: 'POST',
        body: JSON.stringify({
          night: night.night,
          slot,
          party,
          zone_id: customerPicks ? undefined : zoneId,
          table_id: customerPicks ? pick?.id : undefined,
          name: cleanName,
          phone: phone.trim() || undefined,
          note: note.trim() || undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!res.ok || !body.code) {
        toast.error(errorText(t, body.error))
        if (customerPicks && body.error && TABLE_GONE.has(body.error)) {
          setPick(null)
          loadPlan(night.night)
        }
        return
      }
      toast.success(t('book.sent'))
      router.push(`/liff/${session.branch.code.toLowerCase()}/ticket/${body.code}`)
    } catch {
      toast.error(t('shell.errorGeneric'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="cx-label">{t('book.date')}</p>
        <div className="cx-dates num">
          {data.nights.map((n, i) => {
            const d = new Date(`${n.night}T00:00:00Z`)
            return (
              <button
                key={n.night}
                type="button"
                disabled={n.closed}
                aria-pressed={i === nightIdx}
                title={n.reason ? t(`errors.${n.reason}`) : undefined}
                onClick={() => {
                  setNightIdx(i)
                  setSlot(null)
                  setPick(null)
                }}
                data-testid={`cx-date-${n.night}`}
              >
                {weekdays[weekdayIndex(n.night)]}
                <b>{d.getUTCDate()}</b>
              </button>
            )
          })}
        </div>
      </div>

      {night && !night.closed && (
        <>
          <div>
            <p className="cx-label">{t('book.time')}</p>
            {night.slots.length === 0 ? (
              <p className="text-sm text-cx-muted">{t('book.noSlots')}</p>
            ) : (
              <div className="cx-slots num">
                {night.slots.map((sl) => (
                  <button key={sl} type="button" aria-pressed={slot === sl} onClick={() => setSlot(sl)} data-testid={`cx-slot-${sl}`}>
                    {sl}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="cx-label">{t('book.party')}</p>
            <div className="cx-stepper">
              <button type="button" onClick={() => changeParty(Math.max(data.party_min, party - 1))} aria-label="-">
                <Minus className="size-4" aria-hidden />
              </button>
              <b className="num">{t('book.partyValue', { count: party })}</b>
              <button type="button" onClick={() => changeParty(Math.min(data.party_max, party + 1))} aria-label="+">
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          {customerPicks ? (
            <div data-testid="cx-table-section">
              <p className="cx-label">{t('book.table')}</p>
              {planState === 'loading' ? (
                <CxSkeleton rows={1} />
              ) : planState === 'error' || !plan ? (
                <CxErrorRetry message={t('shell.errorGeneric')} onRetry={() => loadPlan(night.night)} />
              ) : (
                <TablePlan
                  zones={plan}
                  party={party}
                  selected={pick?.id ?? null}
                  onSelect={(x, z) => setPick({ id: x.id, label: x.label, zone: z.name, min: x.seats_min, max: x.seats_max })}
                />
              )}
              {pick ? (
                <p className="cx-picked mt-3" data-testid="cx-table-picked">
                  <Armchair className="size-4 flex-none" aria-hidden />
                  {t('book.tableChosen', { label: pick.label, zone: pick.zone })}
                </p>
              ) : (
                planState === 'ready' && <p className="mt-2 text-xs text-cx-muted">{t('book.tableHint')}</p>
              )}
            </div>
          ) : (
            <div>
              <p className="cx-label">{t('book.zone')}</p>
              <div className="cx-slots" style={{ gridTemplateColumns: `repeat(${Math.min(data.zones.length + 1, 3)}, minmax(0, 1fr))` }}>
                {data.zones.map((z) => (
                  <button key={z.id} type="button" aria-pressed={zoneId === z.id} onClick={() => setZoneId(z.id)} data-testid={`cx-zone-${z.id}`}>
                    {z.name}
                  </button>
                ))}
                <button type="button" aria-pressed={zoneId === null} onClick={() => setZoneId(null)} data-testid="cx-zone-any">
                  {t('book.zoneAny')}
                </button>
              </div>
            </div>
          )}

          <label className="block">
            <span className="cx-label">{t('book.name')}</span>
            <input className="cx-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="cx-book-name" />
          </label>
          <label className="block">
            <span className="cx-label">{t('book.phone')}</span>
            <input className="cx-input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" />
          </label>
          <label className="block">
            <span className="cx-label">{t('book.note')}</span>
            <input className="cx-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('book.notePlaceholder')} maxLength={300} />
          </label>

          {data.inStoreDeposits > 0 && (
            <div className="cx-card px-3 py-2.5 text-[12.5px] text-cx-muted" data-testid="cx-has-deposits">
              {t('book.hasDeposits', { count: data.inStoreDeposits })}
            </div>
          )}

          <button type="button" className="cx-btn mt-auto" disabled={pending || !slot || (customerPicks && !pick)} onClick={() => void submit()} data-testid="cx-book-submit">
            {t('book.submit')}
          </button>
        </>
      )}
    </div>
  )
}
