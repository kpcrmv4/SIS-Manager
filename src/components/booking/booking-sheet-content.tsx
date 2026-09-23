'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Wine } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { checkInBooking, assignTable } from '@/lib/booking/actions'
import type { BookingDetail } from '@/lib/booking/actions'
import { bookingBadgeTone, minutesLate, LIVE_STATUSES } from '@/lib/booking/format'
import { businessNight, formatShortDate, formatTime, type AppLocale } from '@/lib/date'

/**
 * The booking sheet's content — shared by the scan result (rendered inline,
 * no dialog chrome) and the /bookings detail dialog (P2-B2). Code, name,
 * phone/source, a late/status badge, the kv rows, the gold deposits box and
 * "ลูกค้ามาแล้ว" all live here so both callers stay in lockstep.
 */
export function BookingSheetContent({
  detail,
  branchId,
  locale,
  canChangeTable,
  onCheckedIn,
  onClose,
}: {
  detail: BookingDetail
  branchId: string
  locale: AppLocale
  canChangeTable: boolean
  onCheckedIn: () => void
  onClose?: () => void
}) {
  const t = useTranslations('booking')
  const tk = useTranslations('bookings')
  const ts = useTranslations('status')
  const tc = useTranslations('common')
  const tt = useTranslations('tonight')
  const te = useTranslations('errors')

  const [status, setStatus] = useState(detail.status)
  const [tableId, setTableId] = useState(detail.tableId)
  const [tableLabel, setTableLabel] = useState(detail.tableLabel)
  const [changing, setChanging] = useState(false)
  const [checkInPending, startCheckIn] = useTransition()
  const [assignPending, startAssign] = useTransition()

  const late = LIVE_STATUSES.includes(status) && status !== 'arrived' ? minutesLate(detail.night, detail.slotTime) : 0
  const nightWord = detail.night === businessNight() ? t('tonight') : formatShortDate(detail.night, locale)
  const sourceText = detail.source === 'line' ? tk('sourceLineAt', { time: formatTime(detail.createdAt, locale) }) : tk('sourceStaff')

  function doCheckIn() {
    startCheckIn(async () => {
      const res = await checkInBooking(branchId, detail.qrToken)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      setStatus('arrived')
      onCheckedIn()
    })
  }

  function doAssign(newTableId: string) {
    startAssign(async () => {
      const res = await assignTable(detail.id, newTableId || null)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      setTableId(res.data.table_id)
      setTableLabel(detail.tables.find((tb) => tb.id === res.data.table_id)?.label ?? null)
      setChanging(false)
      toast.success(t('assigned'))
    })
  }

  return (
    <div data-testid="booking-sheet" data-booking-id={detail.id}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="code text-muted-token">{detail.code}</div>
          <div className="text-lg font-bold text-ink">{detail.name}</div>
          <div className="text-sm tnum text-muted-token">
            {detail.phone && `${t('phone', { phone: detail.phone })} · `}
            {sourceText}
          </div>
        </div>
        {status === 'arrived' ? (
          <Badge tone="done">{ts('booking.arrived')}</Badge>
        ) : late > 0 ? (
          <Badge tone="progress">{ts('lateBy', { count: late })}</Badge>
        ) : (
          <Badge tone={bookingBadgeTone(status)}>{ts(`booking.${status}`)}</Badge>
        )}
      </div>

      <dl className="kv mb-3">
        <dt>{t('time')}</dt>
        <dd className="tnum">{t('timeValue', { night: nightWord, time: detail.slotTime.slice(0, 5) })}</dd>
        <dt>{t('party')}</dt>
        <dd className="tnum">{t('partyValue', { count: detail.party, zone: detail.zoneName ?? '—' })}</dd>
        <dt>{t('table')}</dt>
        <dd>
          {changing ? (
            <select
              className="input-base py-1 text-sm"
              defaultValue={tableId ?? ''}
              disabled={assignPending}
              onChange={(e) => doAssign(e.target.value)}
              data-testid="change-table-select"
            >
              <option value="">{tc('none')}</option>
              {detail.tables.map((tb) => (
                <option key={tb.id} value={tb.id}>
                  {tb.label}
                </option>
              ))}
            </select>
          ) : (
            <>
              {tableLabel ?? tk('unassigned')}
              {canChangeTable && (
                <button type="button" className="ml-2 text-sm text-brand" onClick={() => setChanging(true)} data-testid="change-table-trigger">
                  {t('changeTable')}
                </button>
              )}
            </>
          )}
        </dd>
        {detail.note && (
          <>
            <dt>{t('note')}</dt>
            <dd>{detail.note}</dd>
          </>
        )}
      </dl>

      <div className="warnbox mb-3 bg-gold-bg text-gold-ink" data-testid="booking-deposits-box">
        <Wine className="size-4 shrink-0" aria-hidden />
        <span>
          {detail.deposits.length
            ? t('depositsHint', {
                count: detail.deposits.length,
                summary: detail.deposits
                  .map((d) => `${d.itemName} — ${tt('expiringMeta', { date: d.expiresAt ? formatShortDate(d.expiresAt, locale) : '—', left: `${d.remainingPercent}%` })}`)
                  .join(', '),
              })
            : t('noDeposits')}
        </span>
      </div>

      <div className="flex gap-2">
        {onClose && (
          <button type="button" className="btn-secondary flex-1 justify-center" onClick={onClose}>
            {tc('close')}
          </button>
        )}
        <button
          type="button"
          className="btn-ok flex-[2] justify-center"
          disabled={status === 'arrived' || checkInPending}
          onClick={doCheckIn}
          data-testid="check-in-button"
        >
          {checkInPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {status === 'arrived' ? t('checkedIn') : t('checkIn')}
        </button>
      </div>
    </div>
  )
}
