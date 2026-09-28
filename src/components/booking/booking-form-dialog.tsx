'use client'

import { useEffect, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from './responsive-dialog'
import { bookingAvailability, createStaffBooking, setTableClosed } from '@/lib/booking/actions'
import { slotOptions } from '@/lib/booking/format'
import type { ZoneRow } from '@/lib/booking/queries'
import { formatShortDate, type AppLocale } from '@/lib/date'

export type BookingSettingsForForm = {
  slotStart: string
  slotEnd: string
  slotMinutes: number
  partyMin: number
  partyMax: number
}

/**
 * รับจอง — staff books a table for a walk-in / phone caller (createStaffBooking). Opened from a
 * table on the plan it starts on that table (R-055). With a table picked, bar / owner may close it
 * for the night instead — ปิดการจองโต๊ะนี้, no customer details (R-056).
 */
export function BookingFormDialog({
  open,
  onOpenChange,
  branchId,
  night,
  zones,
  settings,
  initialZoneId = '',
  initialTableId = '',
  canCloseTable = false,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branchId: string
  night: string
  zones: ZoneRow[]
  settings: BookingSettingsForForm
  initialZoneId?: string
  initialTableId?: string
  canCloseTable?: boolean
  /** after a booking is saved or the table closed */
  onCreated: () => void
}) {
  const t = useTranslations('bookingForm')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const tb = useTranslations('bookingErrors')
  const locale = useLocale() as AppLocale

  const slots = slotOptions(settings.slotStart, settings.slotEnd, settings.slotMinutes)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [nightValue, setNightValue] = useState(night)
  const [slot, setSlot] = useState(slots[0] ?? '')
  const [party, setParty] = useState(Math.min(2, settings.partyMax) || settings.partyMin)
  const [zoneId, setZoneId] = useState(initialZoneId)
  const [tableId, setTableId] = useState(initialTableId)
  const [note, setNote] = useState('')
  const [pending, start] = useTransition()
  const [closing, startClosing] = useTransition()
  // the picked night closed to staff too (past · ปิดประจำสัปดาห์ · ปิดร้าน) — known before save (R-067)
  const [closedFor, setClosedFor] = useState<{ night: string; reason: 'past' | 'closed_weekday' | 'blackout' } | null>(null)

  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(nightValue)) return
    let live = true
    void bookingAvailability(branchId, nightValue, nightValue).then((res) => {
      if (!live) return
      const n = res.ok ? res.data.nights[0] : undefined
      const shut = n?.reason === 'past' || n?.reason === 'closed_weekday' || (n?.reason === 'blackout' && n.blackout_line_only !== true)
      setClosedFor(shut && n ? { night: nightValue, reason: n.reason as 'past' | 'closed_weekday' | 'blackout' } : null)
    })
    return () => {
      live = false
    }
  }, [open, branchId, nightValue])
  const nightClosed = closedFor?.night === nightValue ? closedFor.reason : null

  const tables = zones.find((z) => z.id === zoneId)?.tables ?? []
  const tableLabel = tables.find((tbl) => tbl.id === tableId)?.label ?? null

  function reset() {
    setName('')
    setPhone('')
    setNightValue(night)
    setSlot(slots[0] ?? '')
    setParty(Math.min(2, settings.partyMax) || settings.partyMin)
    setZoneId(initialZoneId)
    setTableId(initialTableId)
    setNote('')
  }

  function closeTable() {
    if (!tableId || !tableLabel) return
    startClosing(async () => {
      const res = await setTableClosed(tableId, nightValue, true)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('closedDone', { table: tableLabel, date: formatShortDate(nightValue, locale) }))
      reset()
      onOpenChange(false)
      onCreated()
    })
  }

  function submit() {
    if (!name.trim() || !slot) {
      toast.error(te('invalid'))
      return
    }
    start(async () => {
      const res = await createStaffBooking({
        branchId,
        night: nightValue,
        slot,
        party,
        name: name.trim(),
        phone: phone.trim() || undefined,
        zoneId: zoneId || undefined,
        tableId: tableId || undefined,
        note: note.trim() || undefined,
      })
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('created', { code: res.data.code }))
      reset()
      onOpenChange(false)
      onCreated()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={tableLabel ? t('titleTable', { table: tableLabel }) : t('title')} width={480}>
      {canCloseTable && tableLabel && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-line-strong bg-surface-2 px-3 py-2.5" data-testid="close-table-box">
          <p className="min-w-0 flex-1 basis-48 text-sm text-ink-2">{t('closeTableHint')}</p>
          <button type="button" className="btn-secondary btn-sm" disabled={closing || pending} onClick={closeTable} data-testid="close-table-button">
            {closing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            {t('closeTable')}
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div>
          <label className="label-base" htmlFor="bf-name">
            {t('name')}
          </label>
          <input id="bf-name" className="input-base" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div>
          <label className="label-base" htmlFor="bf-phone">
            {t('phone')}
          </label>
          <input id="bf-phone" className="input-base" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-base" htmlFor="bf-night">
              {t('night')}
            </label>
            <input id="bf-night" type="date" className="input-base" value={nightValue} onChange={(e) => setNightValue(e.target.value)} aria-invalid={nightClosed ? true : undefined} />
          </div>
          <div>
            <label className="label-base" htmlFor="bf-slot">
              {t('slot')}
            </label>
            <select id="bf-slot" className="input-base" value={slot} onChange={(e) => setSlot(e.target.value)}>
              {slots.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        {nightClosed && (
          <p className="-mt-1 flex items-start gap-1.5 text-sm text-status-progress" role="alert" data-testid="booking-form-night-closed" data-reason={nightClosed}>
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('nightClosed', { reason: tb(nightClosed) })}
          </p>
        )}
        <div>
          <label className="label-base" htmlFor="bf-party">
            {t('party')}
          </label>
          <input
            id="bf-party"
            type="number"
            className="input-base tnum"
            min={settings.partyMin}
            max={settings.partyMax}
            value={party}
            onChange={(e) => setParty(Number(e.target.value))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-base" htmlFor="bf-zone">
              {t('zone')}
            </label>
            <select
              id="bf-zone"
              className="input-base"
              value={zoneId}
              onChange={(e) => {
                setZoneId(e.target.value)
                setTableId('')
              }}
            >
              <option value="">{tc('none')}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-base" htmlFor="bf-table">
              {t('table')}
            </label>
            <select id="bf-table" className="input-base" value={tableId} onChange={(e) => setTableId(e.target.value)} disabled={!zoneId}>
              <option value="">{tc('none')}</option>
              {tables.map((tbl) => (
                <option key={tbl.id} value={tbl.id}>
                  {tbl.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label-base" htmlFor="bf-note">
            {t('note')}
          </label>
          <textarea id="bf-note" className="input-base min-h-16" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button type="button" className="btn-primary" disabled={pending || Boolean(nightClosed)} onClick={submit} data-testid="booking-form-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('submit')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
