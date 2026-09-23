'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { createTable, updateTable } from '@/lib/settings/tables-actions'

export type TableDialogValue = {
  id?: string
  zoneId: string
  label: string
  shape: 'square' | 'round' | 'room'
  seatsMin: number
  seatsMax: number
  sort: number
}

/** เพิ่มโต๊ะ / แก้ไขโต๊ะ — one dialog for create and edit. */
export function TableDialog({
  open,
  onOpenChange,
  branchId,
  zones,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branchId: string
  zones: { id: string; name: string }[]
  initial: TableDialogValue
  onSaved: () => void
}) {
  const t = useTranslations('settingsTables')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [v, setV] = useState(initial)
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = initial.id
        ? await updateTable(initial.id, { label: v.label, zoneId: v.zoneId, shape: v.shape, seatsMin: v.seatsMin, seatsMax: v.seatsMax, sort: v.sort })
        : await createTable({ branchId, zoneId: v.zoneId, label: v.label, shape: v.shape, seatsMin: v.seatsMin, seatsMax: v.seatsMax, sort: v.sort })
      if (!res.ok) {
        toast.error(res.error === 'label_taken' ? t('labelTaken') : te('invalid'))
        return
      }
      toast.success(tc('saved'))
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={initial.id ? tc('edit') : t('addTable')}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="label-base" htmlFor="td-label">
            {t('tableLabel')}
          </label>
          <input id="td-label" className="input-base" value={v.label} onChange={(e) => setV((s) => ({ ...s, label: e.target.value }))} maxLength={12} />
        </div>
        <div>
          <label className="label-base" htmlFor="td-zone">
            {t('colZone')}
          </label>
          <select id="td-zone" className="input-base" value={v.zoneId} onChange={(e) => setV((s) => ({ ...s, zoneId: e.target.value }))}>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-base" htmlFor="td-shape">
            {t('colShape')}
          </label>
          <select id="td-shape" className="input-base" value={v.shape} onChange={(e) => setV((s) => ({ ...s, shape: e.target.value as TableDialogValue['shape'] }))}>
            <option value="square">{t('shape.square')}</option>
            <option value="round">{t('shape.round')}</option>
            <option value="room">{t('shape.room')}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-base" htmlFor="td-min">
              {t('seatsMin')}
            </label>
            <input id="td-min" type="number" min={1} max={100} className="input-base tnum" value={v.seatsMin} onChange={(e) => setV((s) => ({ ...s, seatsMin: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label-base" htmlFor="td-max">
              {t('seatsMax')}
            </label>
            <input id="td-max" type="number" min={1} max={100} className="input-base tnum" value={v.seatsMax} onChange={(e) => setV((s) => ({ ...s, seatsMax: Number(e.target.value) }))} />
          </div>
        </div>
        <div>
          <label className="label-base" htmlFor="td-sort">
            {t('sort')}
          </label>
          <input id="td-sort" type="number" className="input-base tnum" value={v.sort} onChange={(e) => setV((s) => ({ ...s, sort: Number(e.target.value) }))} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button type="button" className="btn-primary" disabled={pending || !v.label.trim() || !v.zoneId} onClick={submit} data-testid="table-dialog-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('save')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
