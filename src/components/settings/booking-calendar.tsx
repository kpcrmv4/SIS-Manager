'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { bookingAvailability, type Availability } from '@/lib/booking/actions'
import { toggleBlackout } from '@/lib/booking/settings-actions'
import { businessNight, formatMonthYear, formatShortDate, weekdayIndex, type AppLocale } from '@/lib/date'

type NightInfo = Availability['nights'][number]

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function ymd(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}
function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

/**
 * วันปิดรับจอง · month calendar — tap a day to add/remove a blackout row. A new one is either
 * งดจองทาง LINE (customers can't book, staff still can) or ปิดร้าน (nobody books) — R-067.
 */
export function BookingCalendar({ branchId, locale }: { branchId: string; locale: AppLocale }) {
  const t = useTranslations('settingsBooking')
  const te = useTranslations('errors')
  const today = businessNight()
  const [y, setY] = useState(Number(today.slice(0, 4)))
  const [m, setM] = useState(Number(today.slice(5, 7)) - 1)
  const [nights, setNights] = useState<Record<string, NightInfo>>({})
  const [loading, setLoading] = useState(true)
  const [reason, setReason] = useState('')
  const [lineOnly, setLineOnly] = useState(true)
  const [pending, start] = useTransition()

  async function load() {
    setLoading(true)
    const from = ymd(y, m, 1)
    const to = ymd(y, m, daysInMonth(y, m))
    const res = await bookingAvailability(branchId, from, to)
    if (res.ok) setNights(Object.fromEntries(res.data.nights.map((n) => [n.night, n])))
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, y, m])

  function go(delta: number) {
    let nm = m + delta
    let ny = y
    if (nm < 0) {
      nm = 11
      ny -= 1
    } else if (nm > 11) {
      nm = 0
      ny += 1
    }
    setM(nm)
    setY(ny)
  }

  function tap(night: string, info: NightInfo | undefined) {
    if (!info || info.reason === 'closed_weekday' || info.reason === 'past') return
    start(async () => {
      const res = await toggleBlackout(branchId, night, reason, lineOnly)
      if (!res.ok) {
        toast.error(te('unknown'))
        return
      }
      toast.success(t(res.data.action === 'removed' ? 'blackoutRemoved' : lineOnly ? 'blackoutAddedLine' : 'blackoutAdded', { date: formatShortDate(night, locale) }))
      void load()
    })
  }

  const first = ymd(y, m, 1)
  const lead = weekdayIndex(first)
  const total = daysInMonth(y, m)
  const weekdays: string[] = t.raw('weekdays')

  return (
    <div className="card-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">{t('calendarTitle', { month: formatMonthYear(first, locale) })}</b>
        <span className="flex gap-1">
          <button type="button" className="btn-ghost btn-sm" aria-label={t('prevMonth')} onClick={() => go(-1)}>
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button type="button" className="btn-ghost btn-sm" aria-label={t('nextMonth')} onClick={() => go(1)}>
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </span>
      </div>

      <div className="mb-3">
        <p className="label-base">{t('modeLabel')}</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('modeLabel')}>
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={lineOnly === v}
              onClick={() => setLineOnly(v)}
              data-testid="cal-mode"
              data-mode={v ? 'line' : 'shop'}
              className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors duration-100 ${lineOnly === v ? 'border-brand bg-surface-2' : 'border-line-soft hover:border-line-strong'}`}
            >
              <span className="text-sm font-semibold text-ink">{t(v ? 'modeLine' : 'modeShop')}</span>
              <span className="text-xs text-muted-token">{t(v ? 'modeLineHint' : 'modeShopHint')}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cal" aria-busy={loading || pending}>
        {weekdays.map((w) => (
          <div key={w} className="h">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <span key={`lead-${i}`} aria-hidden />
        ))}
        {Array.from({ length: total }).map((_, i) => {
          const day = i + 1
          const night = ymd(y, m, day)
          const info = nights[night]
          const lineDay = info?.reason === 'blackout' && info.blackout_line_only === true
          const cls = [info?.reason === 'closed_weekday' ? 'wk' : '', info?.reason === 'blackout' ? (lineDay ? 'xl' : 'x') : '', info?.reason === 'past' ? 'past' : '', info?.full && !info.closed ? 'full' : '', night === today ? 'today' : '']
            .filter(Boolean)
            .join(' ')
          return (
            <button key={night} type="button" className={cls} onClick={() => tap(night, info)} data-testid="cal-day" data-night={night} data-state={lineDay ? 'blackout_line' : info?.reason ?? (info?.full ? 'full' : 'open')}>
              {day}
            </button>
          )
        })}
      </div>

      <div className="legend mt-3">
        <span>
          <i style={{ borderColor: 'var(--urgent)', background: 'var(--urgent-bg)' }} />
          {t('legendBlackout')}
        </span>
        <span>
          <i style={{ borderColor: 'var(--status-info)', borderStyle: 'dashed', background: 'var(--status-info-bg)' }} />
          {t('legendLineOnly')}
        </span>
        <span>
          <i style={{ borderColor: 'transparent', background: 'var(--disabled-bg)' }} />
          {t('legendWeekly')}
        </span>
        <span>
          <i style={{ borderColor: 'transparent', background: 'var(--status-progress-bg)' }} />
          {t('legendFull')}
        </span>
      </div>

      <div className="mt-3">
        <label className="label-base" htmlFor="cal-reason">
          {t('reason')}
        </label>
        <input
          id="cal-reason"
          className="input-base"
          placeholder={t('reasonPlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          data-testid="cal-reason-input"
        />
      </div>
    </div>
  )
}
