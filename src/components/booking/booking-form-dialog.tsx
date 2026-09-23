'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from './responsive-dialog'
import { createStaffBooking } from '@/lib/booking/actions'
import { slotOptions } from '@/lib/booking/format'
import type { ZoneRow } from '@/lib/booking/queries'

export type BookingSettingsForForm = {
  slotStart: string
  slotEnd: string
  slotMinutes: number
  partyMin: number
  partyMax: number
}

/** รับจอง — staff books a table for a walk-in / phone caller (createStaffBooking). */
export function BookingFormDialog({
  open,
  onOpenChange,
  branchId,
  night,
  zones,
  settings,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branchId: string
  night: string
  zones: ZoneRow[]
  settings: BookingSettingsForForm
  onCreated: () => void
}) {
  const t = useTranslations('bookingForm')
  const tc = useTranslations('common')
  const te = useTranslations('errors')

  const slots = slotOptions(settings.slotStart, settings.slotEnd, settings.slotMinutes)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [nightValue, setNightValue] = useState(night)
  const [slot, setSlot] = useState(slots[0] ?? '')
  const [party, setParty] = useState(Math.min(2, settings.partyMax) || settings.partyMin)
  const [zoneId, setZoneId] = useState('')
  const [tableId, setTableId] = useState('')
  const [note, setNote] = useState('')
  const [pending, start] = useTransition()

  const tables = zones.find((z) => z.id === zoneId)?.tables ?? []

  function reset() {
    setName('')
    setPhone('')
    setNightValue(night)
    setSlot(slots[0] ?? '')
    setParty(Math.min(2, settings.partyMax) || settings.partyMin)
    setZoneId('')
    setTableId('')
    setNote('')
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
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('title')} width={480}>
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
            <input id="bf-night" type="date" className="input-base" value={nightValue} onChange={(e) => setNightValue(e.target.value)} />
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
        <button type="button" className="btn-primary" disabled={pending} onClick={submit} data-testid="booking-form-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('submit')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
