'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ChevronRight, CircleCheck, CircleX, Info, Loader2, UserX, Wine } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { CancelDialog } from './cancel-dialog'
import { ConfirmAssignDialog } from './confirm-assign-dialog'
import { NoShowDialog } from './no-show-dialog'
import { RejectDialog } from './reject-dialog'
import { checkInBooking, assignTable } from '@/lib/booking/actions'
import type { BookingDetail } from '@/lib/booking/actions'
import { bookingBadgeTone, minutesLate, LIVE_STATUSES } from '@/lib/booking/format'
import { businessNight, formatShortDate, formatTime, type AppLocale } from '@/lib/date'
import { customerHrefForBooking } from '@/lib/customers/view'

/**
 * The booking sheet's content — shared by the scan result (rendered inline,
 * no dialog chrome) and the /bookings detail dialog (P2-B2). Code, name,
 * phone/source, a late/status badge, the kv rows, the gold deposits box, and
 * the actions the booking still has, here and now (R-053):
 *   waiting   bar / owner: ยืนยัน + จัดโต๊ะ · ปฏิเสธ — tonight anyone may check it in at once
 *   confirmed ลูกค้ามาแล้ว tonight; bar / owner: ไม่มา · ปล่อยโต๊ะ once its time has passed, ยกเลิกการจอง
 *   no-show   ลูกค้ามาแล้ว (มาสาย) tonight
 * No check-in on another night (a note says which), none on a cancelled or rejected one.
 * `onChanged` runs after every change.
 */
export function BookingSheetContent({
  detail,
  branchId,
  locale,
  canChangeTable,
  canCancel,
  onChanged,
  onClose,
}: {
  detail: BookingDetail
  branchId: string
  locale: AppLocale
  canChangeTable: boolean
  canCancel: boolean
  onChanged: () => void
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
  const [cancelOpen, setCancelOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [noShowOpen, setNoShowOpen] = useState(false)

  const late = LIVE_STATUSES.includes(status) && status !== 'arrived' ? minutesLate(detail.night, detail.slotTime) : 0
  const isTonight = detail.night === businessNight()
  const nightWord = isTonight ? t('tonight') : formatShortDate(detail.night, locale)
  const sourceText = detail.source === 'line' ? tk('sourceLineAt', { time: formatTime(detail.createdAt, locale) }) : tk('sourceStaff')

  // what the booking can still become, here and now (R-053); the RPCs hold the same lines
  const barOrOwner = canChangeTable
  const canCheckIn = isTonight && (status === 'pending' || status === 'confirmed' || status === 'no_show')
  const canDecide = barOrOwner && status === 'pending'
  const canNoShow = barOrOwner && status === 'confirmed' && late > 0
  const tableOpen = status === 'pending' || status === 'confirmed' || status === 'arrived'
  const note =
    status === 'pending'
      ? isTonight
        ? t('notePendingTonight')
        : t('notePendingLater', { date: formatShortDate(detail.night, locale) })
      : status === 'confirmed' && !isTonight
        ? t('noteOtherNight', { date: formatShortDate(detail.night, locale) })
        : status === 'no_show' && isTonight
          ? t('noteNoShowTonight')
          : null

  const seat = (id: string | null) => {
    setTableId(id)
    setTableLabel(detail.tables.find((tb) => tb.id === id)?.label ?? null)
  }

  function doCheckIn() {
    startCheckIn(async () => {
      const res = await checkInBooking(branchId, detail.qrToken)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      setStatus('arrived')
      onChanged()
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
          {/* every booking and deposit of this customer (R-048) */}
          <Link
            href={customerHrefForBooking(detail.id)}
            className="mt-1 inline-flex items-center gap-0.5 text-sm font-medium text-brand hover:underline"
            data-testid="booking-customer-history"
          >
            {t('customerHistory')}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
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
              {canChangeTable && tableOpen && (
                <button type="button" className="btn-ghost btn-sm ml-2" onClick={() => setChanging(true)} data-testid="change-table-trigger">
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

      {note && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2" data-testid="booking-note" data-note={status}>
          <Info className="mt-0.5 size-4 flex-none text-status-info" aria-hidden />
          {note}
        </p>
      )}

      {canDecide && (
        <div className="mb-3 flex gap-2" data-testid="booking-decide">
          <button type="button" className="btn-secondary flex-1 justify-center" onClick={() => setRejectOpen(true)} data-testid="reject-booking-button">
            <CircleX className="size-4" aria-hidden />
            {tc('reject')}
          </button>
          <button type="button" className="btn-primary flex-2 justify-center" onClick={() => setConfirmOpen(true)} data-testid="confirm-booking-button">
            <CircleCheck className="size-4" aria-hidden />
            {tk('confirmAssign')}
          </button>
        </div>
      )}

      {(canNoShow || (canCancel && status === 'confirmed')) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {canNoShow && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setNoShowOpen(true)} data-testid="no-show-button">
              <UserX className="size-4" aria-hidden />
              {t('noShow')}
            </button>
          )}
          {canCancel && status === 'confirmed' && (
            <button type="button" className="btn-danger btn-sm" onClick={() => setCancelOpen(true)} data-testid="cancel-booking-button">
              <CircleX className="size-4" aria-hidden />
              {t('cancel')}
            </button>
          )}
        </div>
      )}

      {confirmOpen && (
        <ConfirmAssignDialog
          open
          onOpenChange={setConfirmOpen}
          bookingId={detail.id}
          tables={detail.tables}
          onDone={(id) => {
            setStatus('confirmed')
            seat(id)
            onChanged()
          }}
        />
      )}
      {rejectOpen && (
        <RejectDialog
          open
          onOpenChange={setRejectOpen}
          bookingId={detail.id}
          onDone={() => {
            setStatus('rejected')
            seat(null)
            onChanged()
          }}
        />
      )}
      {noShowOpen && (
        <NoShowDialog
          open
          onOpenChange={setNoShowOpen}
          bookingId={detail.id}
          onDone={() => {
            setStatus('no_show')
            seat(null)
            onChanged()
          }}
        />
      )}
      {cancelOpen && (
        <CancelDialog
          open
          onOpenChange={setCancelOpen}
          bookingId={detail.id}
          onDone={() => {
            setStatus('cancelled')
            seat(null)
            onChanged()
          }}
        />
      )}

      <div className="flex gap-2">
        {onClose && (
          <button type="button" className="btn-secondary flex-1 justify-center" onClick={onClose}>
            {tc('close')}
          </button>
        )}
        {(canCheckIn || status === 'arrived') && (
          <button
            type="button"
            className="btn-ok flex-2 justify-center"
            disabled={status === 'arrived' || checkInPending}
            onClick={doCheckIn}
            data-testid="check-in-button"
          >
            {checkInPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {status === 'arrived' ? t('checkedIn') : status === 'no_show' ? t('checkInLate') : t('checkIn')}
          </button>
        )}
      </div>
    </div>
  )
}
