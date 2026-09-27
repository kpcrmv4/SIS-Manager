'use client'

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { addLiquorItem } from '@/lib/deposit/actions'
import type { LiquorItem } from '@/lib/deposit/items'

const CATEGORIES = ['whisky', 'brandy', 'vodka', 'gin', 'rum', 'tequila', 'wine', 'other'] as const
const MAX_SHOWN = 8

/** Case- and space-insensitive — the same comparison confirm_deposit makes (R-060). */
export const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** The list item this deposit already is: by id, else by exactly the typed name. */
export function initialItem(items: LiquorItem[], itemId: string | null, typed: string): LiquorItem | null {
  return items.find((i) => i.id === itemId) ?? items.find((i) => normName(i.name) === normName(typed)) ?? null
}

/**
 * R-060 · bar confirms the liquor against the shop's list: the item the deposit already matches,
 * or ไม่เจอชื่อเหล้า with a search seeded from what was typed, and เพิ่มรายชื่อเหล้า for a name the
 * list is missing (added to this branch, then picked). Staff and customers never see this.
 */
export function ItemPicker({
  branchId,
  items: initialItems,
  typed,
  value,
  onChange,
  error,
}: {
  branchId: string
  items: LiquorItem[]
  typed: string
  value: LiquorItem | null
  onChange: (item: LiquorItem | null) => void
  error?: string
}) {
  const t = useTranslations('confirmDialog')
  const tcat = useTranslations('settingsItems.categories')
  const tsi = useTranslations('settingsItems')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [items, setItems] = useState(initialItems)
  const [query, setQuery] = useState(typed)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<string>('other')
  const [saving, startSaving] = useTransition()

  // any word of the query (2+ letters) in the name; an empty query lists the start of the list
  const matches = useMemo(() => {
    const words = normName(query).split(' ').filter((w) => w.length >= 2)
    const hit = words.length ? items.filter((i) => words.some((w) => normName(i.name).includes(w))) : items
    return hit.slice(0, MAX_SHOWN)
  }, [items, query])

  function openAdd() {
    setNewName(query.trim() || typed)
    setNewCategory('other')
    setAdding(true)
  }

  function saveNew() {
    startSaving(async () => {
      const res = await addLiquorItem(branchId, newName, newCategory)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      const item = { id: res.data.id, name: res.data.name, category: res.data.category }
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]))
      onChange(item)
      toast.success(res.data.existed ? t('addExisted', { name: item.name }) : t('addDone', { name: item.name }))
      setAdding(false)
    })
  }

  const typedDiffers = !!typed.trim() && (!value || normName(value.name) !== normName(typed))

  return (
    <div data-testid="confirm-item" data-picked={value?.id ?? ''}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label-base mb-0">{t('item')}</span>
        {!value && (
          <span data-testid="confirm-item-not-found">
            <Badge tone="urgent">{t('itemNotFound')}</Badge>
          </span>
        )}
      </div>

      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Check className="size-4 flex-none text-status-done" aria-hidden />
            <span className="min-w-0">
              <b className="block truncate text-ink" data-testid="confirm-item-name">
                {value.name}
              </b>
              <span className="text-xs text-muted-token">{tcat(value.category)}</span>
            </span>
          </span>
          <button type="button" className="btn-ghost btn-sm flex-none" onClick={() => onChange(null)} data-testid="confirm-item-change">
            {t('itemChange')}
          </button>
        </div>
      ) : adding ? null : (
        <div className="flex flex-col gap-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token" aria-hidden />
            <input
              className="input-base pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('itemSearch')}
              aria-label={t('itemSearch')}
              data-testid="confirm-item-search"
            />
          </label>
          {matches.length > 0 ? (
            <ul className="flex flex-col overflow-hidden rounded-[10px] border border-line" role="listbox" aria-label={t('item')}>
              {matches.map((i) => (
                <li key={i.id} className="border-b border-line-soft last:border-b-0">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2"
                    onClick={() => onChange(i)}
                    data-testid="confirm-item-option"
                  >
                    <span className="min-w-0 truncate text-ink">{i.name}</span>
                    <span className="flex-none text-xs text-muted-token">{tcat(i.category)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-token">{t('itemNoMatch')}</p>
          )}
          <button type="button" className="btn-secondary btn-sm self-start" onClick={openAdd} data-testid="confirm-item-add">
            <Plus className="size-4" aria-hidden />
            {t('itemAdd')}
          </button>
        </div>
      )}
      {typedDiffers && <p className="help-text">{t('itemTyped', { name: typed })}</p>}
      {error && !value && <p className="help-text text-urgent">{error}</p>}

      {/* inline, not a second dialog: a dialog opened from inside this one sat beneath its overlay */}
      {adding && (
        <div className="mt-2 flex flex-col gap-3 rounded-[10px] border border-line bg-surface-2 p-3" data-testid="confirm-item-add-panel">
          <div>
            <p className="text-sm font-semibold text-ink">{t('addTitle')}</p>
            <p className="text-xs text-muted-token">{t('addHelp')}</p>
          </div>
          <div>
            <label className="label-base" htmlFor="add-item-name">
              {t('item')}
            </label>
            <input id="add-item-name" className="input-base" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} data-testid="add-item-name" />
          </div>
          <div>
            <label className="label-base" htmlFor="add-item-category">
              {tsi('category')}
            </label>
            <select id="add-item-category" className="input-base" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} data-testid="add-item-category">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tcat(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(false)} disabled={saving}>
              {tc('cancel')}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={saveNew} disabled={saving || !newName.trim()} data-testid="add-item-save">
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('addSave')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
