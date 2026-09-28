'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { PhotoPicker } from './photo-picker'
import { disposeDeposits } from '@/lib/deposit/actions'

/**
 * bar/owner: dispose of expired deposits — irreversible. R-076: a photo of the bottles taken off the
 * shelf is required, the batch becomes one disposal record (DSP-…) and the page opens it; the
 * customer is not messaged.
 */
export function DisposeDialog({
  open,
  onOpenChange,
  depositIds,
  summary = [],
  branchId,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  depositIds: string[]
  /** what is being disposed of — code, liquor and bottles each, and the total on top (owner, 2026-09-28) */
  summary?: { id: string; code: string; item: string; bottles: number }[]
  branchId: string
  onDone?: () => void
}) {
  const t = useTranslations('disposeDialog')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [pending, start] = useTransition()
  const count = depositIds.length
  const bottles = summary.reduce((n, s) => n + s.bottles, 0)

  function submit() {
    start(async () => {
      const res = await disposeDeposits(depositIds, reason, photos)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('done', { count: res.data.count, code: res.data.code }))
      onOpenChange(false)
      onDone?.()
      router.push(`/deposits/disposals/${res.data.code}`)
    })
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { count })}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-danger" onClick={submit} disabled={pending || !count || !photos.length} data-testid="dispose-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('submit')}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        {summary.length > 0 && (
          <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-3" data-testid="dispose-summary">
            <p className="text-[15px] font-bold text-urgent tnum" data-testid="dispose-total">
              {t('total', { bottles, count })}
            </p>
            <ul className="mt-2 divide-y divide-urgent-ring/40 text-sm">
              {summary.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-1.5" data-testid="dispose-summary-row">
                  <span className="code shrink-0">{s.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{s.item}</span>
                  <span className="shrink-0 font-semibold text-ink tnum">{t('bottles', { count: s.bottles })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm text-muted-token" data-testid="dispose-dialog-body">
          {t('body')}
        </p>
        <div>
          <label className="label-base">{t('photo')}</label>
          <PhotoPicker branchId={branchId} paths={photos} onChange={setPhotos} addLabel={t('photoAdd')} helpText={t('photoHelp')} testId="dispose-photo-add" />
        </div>
        <div>
          <label className="label-base" htmlFor="dispose-reason">
            {t('reason')}
          </label>
          <input id="dispose-reason" className="input-base" placeholder={t('reasonDefault')} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </ActionDialog>
  )
}
