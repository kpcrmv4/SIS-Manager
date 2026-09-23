'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { PhotoPicker } from './photo-picker'
import { confirmDeposit } from '@/lib/deposit/actions'

/** bar/owner: % remaining per bottle + a confirm photo → the deposit moves to in_store. */
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

  function submit() {
    start(async () => {
      const res = await confirmDeposit(depositId, levels, photos)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('done'))
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
          <button type="button" className="btn-primary" onClick={submit} disabled={pending || !photos.length}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('submit')}
          </button>
        </>
      }
    >
      <div className="space-y-2.5">
        {levels.map((lvl, i) => (
          <label key={i} className="flex items-center gap-2.5 text-sm">
            <span className="w-32 shrink-0 text-ink-2">{t('percent', { n: i + 1 })}</span>
            <input
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={lvl}
              onChange={(e) => setLevels((prev) => prev.map((v, j) => (j === i ? Number(e.target.value) : v)))}
              className="input-base w-24 tnum"
              data-testid={`confirm-level-${i + 1}`}
            />
          </label>
        ))}
        <div>
          <label className="label-base">{t('photo')}</label>
          <PhotoPicker branchId={branchId} paths={photos} onChange={setPhotos} addLabel={td('actionConfirm')} testId="confirm-photo-add" />
        </div>
      </div>
    </ActionDialog>
  )
}
