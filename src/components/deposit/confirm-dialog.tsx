'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { PhotoPicker } from './photo-picker'
import { confirmDeposit } from '@/lib/deposit/actions'
import { queuePrint, type PrintJobType } from '@/lib/deposit/print'
import { getPrintStatus, type PrintStatusView } from '@/lib/print/actions'

/**
 * bar/owner: % remaining per bottle + a confirm photo → the deposit moves to in_store, then the
 * receipt and the bottle label go to the printer — both ticked by default, untick to skip (owner).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  depositId,
  branchId,
  quantity,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  depositId: string
  branchId: string
  quantity: number
}) {
  const t = useTranslations('confirmDialog')
  const td = useTranslations('deposit')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: quantity }, () => 100))
  const [photos, setPhotos] = useState<string[]>([])
  const [pending, start] = useTransition()
  const [print, setPrint] = useState<Record<PrintJobType, boolean>>({ receipt: true, label: true })
  const [printer, setPrinter] = useState<PrintStatusView['state'] | null>(null)
  const printing = print.receipt || print.label

  // say up front when the printer is not there — the job still queues and prints later
  useEffect(() => {
    if (!open) return
    let live = true
    void getPrintStatus(branchId)
      .then((res) => {
        if (live && res.ok) setPrinter(res.data.state)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [open, branchId])

  const setLevel = (i: number, raw: string) => {
    const n = Math.min(100, Math.max(0, Math.round(Number(raw) || 0)))
    setLevels((prev) => prev.map((v, j) => (j === i ? n : v)))
  }

  function submit() {
    start(async () => {
      const res = await confirmDeposit(depositId, levels, photos)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      const types = (['receipt', 'label'] as const).filter((k) => print[k])
      const queued = await Promise.all(types.map((k) => queuePrint(depositId, k).catch(() => ({ ok: false as const }))))
      if (queued.some((r) => !r.ok)) toast.error(t('printFailed'))
      else toast.success(types.length ? t('donePrinted') : t('done'))
      onOpenChange(false)
    })
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('body')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending || !photos.length} data-testid="confirm-submit">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : printing && <Printer className="size-4" aria-hidden />}
            {printing ? t('submitPrint') : t('submit')}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        {/* type the % or drag the bar — both edit the same number */}
        {levels.map((lvl, i) => (
          <div key={i} className="text-sm">
            <div className="flex items-center justify-between gap-2.5">
              <label htmlFor={`confirm-level-${i + 1}`} className="text-ink-2">
                {t('percent', { n: i + 1 })}
              </label>
              <span className="flex items-center gap-1.5">
                <input
                  id={`confirm-level-${i + 1}`}
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  value={lvl}
                  onChange={(e) => setLevel(i, e.target.value)}
                  className="input-base w-20 text-right tnum"
                  data-testid={`confirm-level-${i + 1}`}
                />
                <span className="text-muted-token">%</span>
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={lvl}
              onChange={(e) => setLevel(i, e.target.value)}
              aria-label={t('percent', { n: i + 1 })}
              aria-valuetext={`${lvl}%`}
              className="level-range mt-1.5"
              style={{ ['--lvl' as string]: `${lvl}%` }}
              data-testid={`confirm-level-range-${i + 1}`}
            />
          </div>
        ))}
        <div>
          <label className="label-base">{t('photo')}</label>
          <PhotoPicker branchId={branchId} paths={photos} onChange={setPhotos} addLabel={td('actionConfirm')} testId="confirm-photo-add" />
        </div>
        <fieldset className="border-t border-line-soft pt-3" data-testid="confirm-print">
          <legend className="label-base float-left mb-2 w-full">{t('printTitle')}</legend>
          <div className="clear-both flex flex-wrap gap-2">
            {(['receipt', 'label'] as const).map((k) => (
              <label key={k} className="chip cursor-pointer gap-2 has-checked:border-brand has-checked:text-ink">
                <input
                  type="checkbox"
                  checked={print[k]}
                  onChange={(e) => setPrint((p) => ({ ...p, [k]: e.target.checked }))}
                  className="size-4 accent-(--brand)"
                  data-testid={`confirm-print-${k}`}
                />
                {k === 'receipt' ? t('printReceipt') : t('printLabel')}
              </label>
            ))}
          </div>
          <p className="help-text">{printing && printer === 'offline' ? t('printOffline') : printing && printer === 'not_set_up' ? t('printNotSetUp') : t('printHelp')}</p>
        </fieldset>
      </div>
    </ActionDialog>
  )
}
