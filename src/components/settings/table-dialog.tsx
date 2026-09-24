'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { bangkokDate, formatShortDate, type AppLocale } from '@/lib/date'
import { addTableBlock, createTable, removeTableBlock, updateTable } from '@/lib/settings/tables-actions'

export type TableDialogValue = {
  id?: string
  zoneId: string
  label: string
  shape: 'square' | 'round' | 'room'
  seatsMin: number
  seatsMax: number
  sort: number
  customerBookable: boolean
  blocks: { id: string; night: string }[]
}

/** เพิ่มโต๊ะ / แก้ไขโต๊ะ — one dialog for create and edit; closed nights (R-036) save at once. */
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
  const locale = useLocale() as AppLocale
  const [v, setV] = useState(initial)
  const [pending, start] = useTransition()
  const [blocks, setBlocks] = useState(initial.blocks)
  const [blockDate, setBlockDate] = useState('')
  const [blockPending, startBlock] = useTransition()
  const today = bangkokDate()
  const day = (night: string) => formatShortDate(`${night}T12:00:00+07:00`, locale)

  function submit() {
    start(async () => {
      const patch = { label: v.label, zoneId: v.zoneId, shape: v.shape, seatsMin: v.seatsMin, seatsMax: v.seatsMax, sort: v.sort, customerBookable: v.customerBookable }
      const res = initial.id ? await updateTable(initial.id, patch) : await createTable({ branchId, ...patch })
      if (!res.ok) {
        toast.error(res.error === 'label_taken' ? t('labelTaken') : te('invalid'))
        return
      }
      toast.success(tc('saved'))
      onOpenChange(false)
      onSaved()
    })
  }

  function addBlock() {
    const tableId = initial.id
    const night = blockDate
    if (!tableId || !night || blocks.some((b) => b.night === night)) return
    startBlock(async () => {
      const res = await addTableBlock(branchId, tableId, night)
      if (!res.ok) {
        toast.error(te('invalid'))
        return
      }
      setBlocks((list) => [...list, { id: res.data.id, night }].sort((a, b) => (a.night < b.night ? -1 : 1)))
      setBlockDate('')
      toast.success(t('blockAdded', { date: day(night) }))
      onSaved()
    })
  }

  function removeBlock(b: { id: string; night: string }) {
    startBlock(async () => {
      const res = await removeTableBlock(b.id)
      if (!res.ok) {
        toast.error(te('invalid'))
        return
      }
      setBlocks((list) => list.filter((x) => x.id !== b.id))
      toast.success(t('blockRemoved', { date: day(b.night) }))
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

        <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
          <div>
            <div className="text-sm font-semibold text-ink">{t('tableBookable')}</div>
            <div className="text-xs text-muted-token">{t('tableBookableHelp')}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={v.customerBookable}
            aria-label={t('tableBookable')}
            className="tg"
            onClick={() => setV((s) => ({ ...s, customerBookable: !s.customerBookable }))}
            data-testid="table-bookable-switch"
          />
        </div>

        {initial.id && (
          <div className="border-t border-line pt-3" data-testid="table-blocks">
            <div className="text-sm font-semibold text-ink">{t('blockedDates')}</div>
            <div className="mb-2 text-xs text-muted-token">{t('blockedDatesHelp')}</div>
            <div className="flex gap-2">
              <input
                type="date"
                className="input-base tnum"
                min={today}
                value={blockDate}
                onChange={(e) => setBlockDate(e.target.value)}
                aria-label={t('blockedDates')}
                data-testid="table-block-date"
              />
              <button type="button" className="btn-secondary shrink-0" disabled={!blockDate || blockPending} onClick={addBlock} data-testid="table-block-add">
                {blockPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('addBlock')}
              </button>
            </div>
            {blocks.length === 0 ? (
              <p className="mt-2 text-xs text-muted-token">{t('noBlocks')}</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {blocks.map((b) => (
                  <li key={b.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2.5 pr-1 text-xs tnum" data-testid="table-block" data-night={b.night}>
                    {day(b.night)}
                    <button
                      type="button"
                      className="grid size-5 place-items-center rounded-full border border-line bg-card text-muted-token hover:text-ink"
                      aria-label={t('removeBlock', { date: day(b.night) })}
                      disabled={blockPending}
                      onClick={() => removeBlock(b)}
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
