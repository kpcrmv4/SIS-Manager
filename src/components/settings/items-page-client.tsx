'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/states'
import { ListRow } from '@/components/ui/list-row'
import { ItemDialog, type ItemDialogValue } from './item-dialog'
import { updateItem } from '@/lib/settings/items-actions'

export type ItemRow = { id: string; name: string; category: string; branchId: string | null; active: boolean; sort: number }

export function ItemsPageClient({ branches, items }: { branches: { id: string; name: string }[]; items: ItemRow[] }) {
  const t = useTranslations('settingsItems')
  const tc = useTranslations('common')
  const router = useRouter()
  const [dialog, setDialog] = useState<ItemDialogValue | null>(null)
  const refresh = () => router.refresh()
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? '—' : t('allBranches'))

  const openEdit = (row: ItemRow) =>
    setDialog({ id: row.id, name: row.name, category: row.category, branchId: row.branchId, active: row.active, sort: row.sort })

  async function toggleActive(row: ItemRow) {
    const res = await updateItem(row.id, { active: !row.active })
    if (!res.ok) return toast.error(tc('errorGeneric'))
    refresh()
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={() => setDialog({ name: '', category: 'other', branchId: null, active: true, sort: items.length })}
          data-testid="add-item-button"
        >
          <Plus className="size-4" aria-hidden />
          {t('add')}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState message={t('emptyBody')} />
      ) : (
        <>
          <div className="panel hidden overflow-x-auto nav:block" data-testid="items-table-desktop">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('name')}</th>
                  <th>{t('category')}</th>
                  <th>{t('branch')}</th>
                  <th>{t('active')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name}</b>
                    </td>
                    <td>{t(`categories.${row.category}`)}</td>
                    <td>{branchName(row.branchId)}</td>
                    <td>
                      <button type="button" role="switch" aria-checked={row.active} aria-label={`${t('active')} ${row.name}`} className="tg" onClick={() => void toggleActive(row)} data-testid="item-active-toggle" />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => openEdit(row)}
                      >
                        {tc('edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel nav:hidden" data-testid="items-list-mobile">
            {items.map((row) => (
              <ListRow
                key={row.id}
                title={row.name}
                meta={`${t(`categories.${row.category}`)} · ${branchName(row.branchId)}`}
                aside={
                  <>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.active}
                      aria-label={`${t('active')} ${row.name}`}
                      className="tg"
                      onClick={() => void toggleActive(row)}
                      data-testid="item-active-toggle-mobile"
                    />
                    <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(row)}>
                      {tc('edit')}
                    </button>
                  </>
                }
              />
            ))}
          </div>
        </>
      )}

      {dialog && <ItemDialog open branches={branches} initial={dialog} onOpenChange={(v) => !v && setDialog(null)} onSaved={refresh} />}
    </>
  )
}
