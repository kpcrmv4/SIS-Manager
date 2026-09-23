'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { createZone, updateZone } from '@/lib/settings/tables-actions'

export type ZoneDialogValue = { id?: string; name: string; customerBookable: boolean; sort: number }

/** เพิ่มโซน / แก้ไขโซน — one dialog for create and edit. */
export function ZoneDialog({
  open,
  onOpenChange,
  branchId,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branchId: string
  initial: ZoneDialogValue
  onSaved: () => void
}) {
  const t = useTranslations('settingsTables')
  const tc = useTranslations('common')
  const [name, setName] = useState(initial.name)
  const [bookable, setBookable] = useState(initial.customerBookable)
  const [sort, setSort] = useState(initial.sort)
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = initial.id
        ? await updateZone(initial.id, { name, customerBookable: bookable, sort })
        : await createZone(branchId, name, bookable, sort)
      if (!res.ok) {
        toast.error(tc('errorGeneric'))
        return
      }
      toast.success(tc('saved'))
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={initial.id ? tc('edit') : t('addZone')}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="label-base" htmlFor="zd-name">
            {t('zoneName')}
          </label>
          <input id="zd-name" className="input-base" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div>
          <label className="label-base" htmlFor="zd-sort">
            {t('sort')}
          </label>
          <input id="zd-sort" type="number" className="input-base tnum" value={sort} onChange={(e) => setSort(Number(e.target.value))} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink">{t('colBookable')}</span>
          <button type="button" role="switch" aria-checked={bookable} aria-label={t('colBookable')} className="tg" onClick={() => setBookable((v) => !v)} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button type="button" className="btn-primary" disabled={pending || !name.trim()} onClick={submit} data-testid="zone-dialog-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('save')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
