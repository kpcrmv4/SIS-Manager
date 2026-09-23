'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { createItem, updateItem } from '@/lib/settings/items-actions'

const CATEGORIES = ['whisky', 'brandy', 'vodka', 'gin', 'rum', 'tequila', 'wine', 'other'] as const

export type ItemDialogValue = { id?: string; name: string; category: string; branchId: string | null; active: boolean; sort: number }

/** เพิ่มรายการ / แก้ไขรายการเหล้า — one branch or null for every branch. */
export function ItemDialog({
  open,
  onOpenChange,
  branches,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branches: { id: string; name: string }[]
  initial: ItemDialogValue
  onSaved: () => void
}) {
  const t = useTranslations('settingsItems')
  const tc = useTranslations('common')
  const [v, setV] = useState(initial)
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = initial.id
        ? await updateItem(initial.id, { name: v.name, category: v.category, branchId: v.branchId, active: v.active, sort: v.sort })
        : await createItem(v)
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
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={initial.id ? tc('edit') : t('add')}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="label-base" htmlFor="id-name">
            {t('name')}
          </label>
          <input id="id-name" className="input-base" value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} maxLength={120} />
        </div>
        <div>
          <label className="label-base" htmlFor="id-category">
            {t('category')}
          </label>
          <select id="id-category" className="input-base" value={v.category} onChange={(e) => setV((s) => ({ ...s, category: e.target.value }))}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-base" htmlFor="id-branch">
            {t('branch')}
          </label>
          <select id="id-branch" className="input-base" value={v.branchId ?? ''} onChange={(e) => setV((s) => ({ ...s, branchId: e.target.value || null }))}>
            <option value="">{t('allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-base" htmlFor="id-sort">
            {t('sort')}
          </label>
          <input id="id-sort" type="number" className="input-base tnum" value={v.sort} onChange={(e) => setV((s) => ({ ...s, sort: Number(e.target.value) }))} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink">{t('active')}</span>
          <button type="button" role="switch" aria-checked={v.active} aria-label={t('active')} className="tg" onClick={() => setV((s) => ({ ...s, active: !s.active }))} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button type="button" className="btn-primary" disabled={pending || !v.name.trim()} onClick={submit} data-testid="item-dialog-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('save')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
