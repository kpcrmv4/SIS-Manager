'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { updatePrintSettings, type PrintSettingsView, type PrintWorkingHours } from '@/lib/print/actions'

const pad = (n: number) => String(n).padStart(2, '0')
const toTime = (h: number, m: number) => `${pad(h)}:${pad(m)}`
const fromTime = (v: string): [number, number] => {
  const [h, m] = v.split(':').map((n) => Number(n) || 0)
  return [h, m]
}

const DEFAULT_HOURS: PrintWorkingHours = { enabled: false, startHour: 12, startMinute: 0, endHour: 6, endMinute: 0 }

/** QR (from the branch's LINE OA), print-server working hours, printer name — the fields not already on the branch form. */
export function PrintSettingsForm({ branchId, initial }: { branchId: string; initial: PrintSettingsView }) {
  const t = useTranslations('print')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [showQr, setShowQr] = useState(initial.showQr)
  const [qrCodeImageUrl, setQrCodeImageUrl] = useState(initial.qrCodeImageUrl)
  const [hours, setHours] = useState<PrintWorkingHours>(initial.workingHours ?? DEFAULT_HOURS)
  const [printerName, setPrinterName] = useState(initial.printerName ?? '')
  const [pending, start] = useTransition()

  function save() {
    start(async () => {
      const res = await updatePrintSettings(branchId, { showQr, workingHours: hours, printerName })
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      setQrCodeImageUrl(res.data.qrCodeImageUrl)
      toast.success(tc('saved'))
    })
  }

  return (
    <div className="card-surface flex flex-col gap-4 p-4" data-testid="print-settings-form">
      <div className="sec-head">{t('sectionTitle')}</div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-medium text-ink">{t('showQr')}</span>
          {!initial.hasLineOa && <p className="help-text">{t('showQrNoOa')}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showQr}
          aria-label={t('showQr')}
          className="tg"
          disabled={!initial.hasLineOa}
          onClick={() => setShowQr((s) => !s)}
          data-testid="print-show-qr"
        />
      </div>

      {showQr && qrCodeImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a data: URL, next/image cannot optimize it
        <img src={qrCodeImageUrl} alt={t('showQr')} width={120} height={120} className="rounded-md ring-1 ring-line" data-testid="print-qr-preview" />
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{t('workingHoursEnabled')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={hours.enabled}
          aria-label={t('workingHoursEnabled')}
          className="tg"
          onClick={() => setHours((h) => ({ ...h, enabled: !h.enabled }))}
          data-testid="print-hours-enabled"
        />
      </div>

      {hours.enabled && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-base" htmlFor="ps-start">
              {t('workingHoursStart')}
            </label>
            <input
              id="ps-start"
              type="time"
              className="input-base tnum"
              value={toTime(hours.startHour, hours.startMinute)}
              onChange={(e) => {
                const [h, m] = fromTime(e.target.value)
                setHours((s) => ({ ...s, startHour: h, startMinute: m }))
              }}
            />
          </div>
          <div>
            <label className="label-base" htmlFor="ps-end">
              {t('workingHoursEnd')}
            </label>
            <input
              id="ps-end"
              type="time"
              className="input-base tnum"
              value={toTime(hours.endHour, hours.endMinute)}
              onChange={(e) => {
                const [h, m] = fromTime(e.target.value)
                setHours((s) => ({ ...s, endHour: h, endMinute: m }))
              }}
            />
          </div>
        </div>
      )}
      <p className="help-text">{t('workingHoursHelp')}</p>

      <div>
        <label className="label-base" htmlFor="ps-printer">
          {t('printerName')}
        </label>
        <input id="ps-printer" className="input-base" value={printerName} onChange={(e) => setPrinterName(e.target.value)} maxLength={60} placeholder="POS80" aria-describedby="ps-printer-help" />
        {/* the setup zip carries the saved name — name first, then setup */}
        <p id="ps-printer-help" className="help-text">
          {t('printerNameHelp')}
        </p>
      </div>

      <button type="button" className="btn-primary self-start" disabled={pending} onClick={save} data-testid="print-settings-save">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {tc('save')}
      </button>
    </div>
  )
}
