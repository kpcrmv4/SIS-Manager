'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveBookingSettings, type BookingSettingsInput } from '@/lib/booking/settings-actions'

export type BookingSettingsValue = Omit<BookingSettingsInput, 'branchId'>

/** Every booking_settings field (demo lines 630-661) — one save button for the whole form. */
export function BookingSettingsForm({ branchId, initial }: { branchId: string; initial: BookingSettingsValue }) {
  const t = useTranslations('settingsBooking')
  const tc = useTranslations('common')
  const [v, setV] = useState(initial)
  const [pending, start] = useTransition()

  function toggleDay(day: number) {
    setV((s) => ({
      ...s,
      closedWeekdays: s.closedWeekdays.includes(day) ? s.closedWeekdays.filter((d) => d !== day) : [...s.closedWeekdays, day],
    }))
  }

  function save() {
    start(async () => {
      const res = await saveBookingSettings({ branchId, ...v })
      if (!res.ok) {
        toast.error(tc('errorGeneric'))
        return
      }
      toast.success(tc('saved'))
    })
  }

  return (
    <div className="card-surface flex flex-col gap-4 p-4" data-testid="booking-settings-form">
      <Switch label={t('lineEnabled')} help={t('lineEnabledHelp')} checked={v.lineEnabled} onChange={(x) => setV((s) => ({ ...s, lineEnabled: x }))} />
      <Switch label={t('autoConfirm')} help={t('autoConfirmHelp')} checked={v.autoConfirm} onChange={(x) => setV((s) => ({ ...s, autoConfirm: x }))} />

      <div>
        <div className="label-base">{t('tableChoice')}</div>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('tableChoice')}>
          {(['shop', 'customer'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={v.tableChoice === k}
              className="choice-card"
              onClick={() => setV((s) => ({ ...s, tableChoice: k }))}
              data-testid={`table-choice-${k}`}
            >
              <b>{t(k === 'shop' ? 'tableChoiceShop' : 'tableChoiceCustomer')}</b>
              <span>{t(k === 'shop' ? 'tableChoiceShopHelp' : 'tableChoiceCustomerHelp')}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('advanceDays')}>
          <input type="number" min={0} max={365} className="input-base tnum" value={v.advanceDays} onChange={(e) => setV((s) => ({ ...s, advanceDays: Number(e.target.value) }))} />
        </Field>
        <Field label={t('cutoff')}>
          <input type="time" className="input-base tnum" value={v.cutoffTime.slice(0, 5)} onChange={(e) => setV((s) => ({ ...s, cutoffTime: e.target.value }))} />
        </Field>
        <Field label={t('slotStart')}>
          <input type="time" className="input-base tnum" value={v.slotStart.slice(0, 5)} onChange={(e) => setV((s) => ({ ...s, slotStart: e.target.value }))} />
        </Field>
        <Field label={t('slotEnd')}>
          <input type="time" className="input-base tnum" value={v.slotEnd.slice(0, 5)} onChange={(e) => setV((s) => ({ ...s, slotEnd: e.target.value }))} />
        </Field>
        <Field label={t('slotMinutes')}>
          <input type="number" min={5} max={240} className="input-base tnum" value={v.slotMinutes} onChange={(e) => setV((s) => ({ ...s, slotMinutes: Number(e.target.value) }))} />
        </Field>
        <Field label={t('noShowMinutes')}>
          <input type="number" min={1} max={240} className="input-base tnum" value={v.noShowMinutes} onChange={(e) => setV((s) => ({ ...s, noShowMinutes: Number(e.target.value) }))} />
        </Field>
        <Field label={t('maxPerNight')} help={t('maxPerNightHelp')}>
          <input
            type="number"
            min={0}
            className="input-base tnum"
            value={v.maxBookingsPerNight ?? ''}
            onChange={(e) => setV((s) => ({ ...s, maxBookingsPerNight: e.target.value === '' ? null : Number(e.target.value) }))}
          />
        </Field>
        <Field label={t('cancelHours')}>
          <input type="number" min={0} max={72} className="input-base tnum" value={v.customerCancelHours} onChange={(e) => setV((s) => ({ ...s, customerCancelHours: Number(e.target.value) }))} />
        </Field>
        <Field label={t('partyMin')}>
          <input type="number" min={1} max={200} className="input-base tnum" value={v.partyMin} onChange={(e) => setV((s) => ({ ...s, partyMin: Number(e.target.value) }))} />
        </Field>
        <Field label={t('partyMax')}>
          <input type="number" min={1} max={200} className="input-base tnum" value={v.partyMax} onChange={(e) => setV((s) => ({ ...s, partyMax: Number(e.target.value) }))} />
        </Field>
      </div>

      <div>
        <label className="label-base">{t('closedWeekdays')}</label>
        <div className="days" role="group" aria-label={t('closedWeekdays')}>
          {t.raw('weekdays').map((label: string, i: number) => (
            <button key={i} type="button" aria-pressed={v.closedWeekdays.includes(i)} onClick={() => toggleDay(i)}>
              {label}
            </button>
          ))}
        </div>
        <p className="help-text">{t('closedWeekdaysHelp')}</p>
      </div>

      <button type="button" className="btn-primary self-start" disabled={pending} onClick={save} data-testid="booking-settings-save">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {tc('save')}
      </button>
    </div>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-base">{label}</span>
      {children}
      {help && <p className="help-text">{help}</p>}
    </label>
  )
}

function Switch({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-xs text-muted-token">{help}</div>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="tg" onClick={() => onChange(!checked)} />
    </div>
  )
}
