'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { PhotoPicker } from './photo-picker'
import { receiveRequest } from '@/lib/deposit/actions'

/** staff/bar/owner: a customer's LINE deposit request (status requested) is handed over the bar — qty + photo. */
export function ReceiveDialog({
  open,
  onOpenChange,
  depositId,
  branchId,
  defaultQuantity,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  depositId: string
  branchId: string
  defaultQuantity: number
}) {
  const t = useTranslations('depositForm')
  const td = useTranslations('deposit')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [quantity, setQuantity] = useState(defaultQuantity)
  const [photos, setPhotos] = useState<string[]>([])
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await receiveRequest({ depositId, quantity, photoPaths: photos })
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('created', { code: res.data?.code ?? '' }))
      onOpenChange(false)
    })
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={td('actionReceive')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending || !photos.length} data-testid="receive-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {td('actionReceive')}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label className="label-base" htmlFor="receive-qty">
            {t('quantity')}
          </label>
          <input
            id="receive-qty"
            type="number"
            min={1}
            max={50}
            inputMode="numeric"
            className="input-base w-24 tnum"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label-base">{t('photo')}</label>
          <PhotoPicker branchId={branchId} paths={photos} onChange={setPhotos} addLabel={t('photoAdd')} helpText={t('photoHelp')} testId="receive-photo-add" />
        </div>
      </div>
    </ActionDialog>
  )
}
