'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { ListRow } from '@/components/ui/list-row'
import { ZoneDialog, type ZoneDialogValue } from './zone-dialog'
import { TableDialog, type TableDialogValue } from './table-dialog'
import { updateZone, updateTable, deleteZone } from '@/lib/settings/tables-actions'

export type TableRow = {
  id: string
  label: string
  shape: 'square' | 'round' | 'room'
  seatsMin: number
  seatsMax: number
  sort: number
  active: boolean
  /** off = customers can never pick this table themselves (R-036) */
  customerBookable: boolean
  /** nights from tonight on when customers cannot pick it */
  blocks: { id: string; night: string }[]
}
export type ZoneWithTables = { id: string; name: string; sort: number; customerBookable: boolean; active: boolean; tables: TableRow[] }

export function TablesPageClient({ branchId, zones, tableChoice }: { branchId: string; zones: ZoneWithTables[]; tableChoice: 'shop' | 'customer' }) {
  const t = useTranslations('settingsTables')
  const tc = useTranslations('common')
  const router = useRouter()
  const [zoneDialog, setZoneDialog] = useState<ZoneDialogValue | null>(null)
  const [tableDialog, setTableDialog] = useState<TableDialogValue | null>(null)

  const refresh = () => router.refresh()
  const zoneOptions = zones.filter((z) => z.active).map((z) => ({ id: z.id, name: z.name }))

  const seatsText = (row: TableRow) => (row.seatsMin === row.seatsMax ? String(row.seatsMin) : `${row.seatsMin}–${row.seatsMax}`)
  const editTable = (z: ZoneWithTables, row: TableRow) =>
    setTableDialog({
      id: row.id,
      zoneId: z.id,
      label: row.label,
      shape: row.shape,
      seatsMin: row.seatsMin,
      seatsMax: row.seatsMax,
      sort: row.sort,
      customerBookable: row.customerBookable,
      blocks: row.blocks,
    })
  // may a customer pick this table: the zone's switch, then the table's own; then its closed nights
  const bookable = (z: ZoneWithTables, row: TableRow) => {
    const state = !z.customerBookable ? 'zone' : !row.customerBookable ? 'off' : 'on'
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span data-testid="table-book-badge" data-state={state} data-label={row.label}>
          <Badge tone={state === 'on' ? 'done' : 'pending'}>{t(state === 'zone' ? 'zoneClosed' : state === 'off' ? 'tableClosed' : 'tableOpen')}</Badge>
        </span>
        {row.blocks.length > 0 && (
          <span data-testid="table-blocks-badge" data-count={row.blocks.length} data-label={row.label}>
            <Badge tone="progress">{t('blockedCount', { count: row.blocks.length })}</Badge>
          </span>
        )}
      </span>
    )
  }

  async function toggleZoneBookable(z: ZoneWithTables) {
    const res = await updateZone(z.id, { customerBookable: !z.customerBookable })
    if (!res.ok) return toast.error(tc('errorGeneric'))
    refresh()
  }
  async function toggleZoneActive(z: ZoneWithTables) {
    const res = await updateZone(z.id, { active: !z.active })
    if (!res.ok) return toast.error(tc('errorGeneric'))
    refresh()
  }
  async function toggleTableActive(row: TableRow) {
    const res = await updateTable(row.id, { active: !row.active })
    if (!res.ok) return toast.error(tc('errorGeneric'))
    refresh()
  }
  async function removeZone(z: ZoneWithTables) {
    if (z.tables.length) return toast.error(tc('errorGeneric'))
    const res = await deleteZone(z.id)
    if (!res.ok) return toast.error(tc('errorGeneric'))
    refresh()
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => setZoneDialog({ name: '', customerBookable: true, sort: zones.length })} data-testid="add-zone-button">
          <Plus className="size-4" aria-hidden />
          {t('addZone')}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!zoneOptions.length}
          onClick={() => setTableDialog({ zoneId: zoneOptions[0]?.id ?? '', label: '', shape: 'square', seatsMin: 1, seatsMax: 4, sort: 0, customerBookable: true, blocks: [] })}
          data-testid="add-table-button"
        >
          <Plus className="size-4" aria-hidden />
          {t('addTable')}
        </button>
      </div>

      {zones.length === 0 ? (
        <EmptyState message={t('emptyBody')} />
      ) : (
        <div className="flex flex-col gap-4">
          {zones.map((z) => (
            <div key={z.id} className="panel" data-testid="zone-card">
              <div className="panel-head justify-between">
                <span className="flex items-center gap-2">{z.name}</span>
                <span className="flex gap-2">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setZoneDialog({ id: z.id, name: z.name, customerBookable: z.customerBookable, sort: z.sort })}>
                    {tc('edit')}
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => void removeZone(z)}>
                    {tc('delete')}
                  </button>
                </span>
              </div>
              <div className="hidden overflow-x-auto nav:block" data-testid="zone-tables-desktop">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('colTable')}</th>
                      <th>{t('colShape')}</th>
                      <th>{t('colSeats')}</th>
                      <th>{t('colBookable')}</th>
                      <th>{t('active')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="num">
                    {z.tables.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <b>{row.label}</b>
                        </td>
                        <td>{t(`shape.${row.shape}`)}</td>
                        <td>
                          {seatsText(row)}
                        </td>
                        <td>{bookable(z, row)}</td>
                        <td>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={row.active}
                            aria-label={`${t('active')} ${row.label}`}
                            className="tg"
                            onClick={() => void toggleTableActive(row)}
                            data-testid="table-active-toggle"
                          />
                        </td>
                        <td>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => editTable(z, row)}>
                            {tc('edit')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!z.tables.length && (
                      <tr>
                        <td colSpan={6} className="text-center text-muted-token">
                          —
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="nav:hidden" data-testid="zone-tables-mobile">
                {z.tables.map((row) => (
                  <ListRow
                    key={row.id}
                    title={row.label}
                    meta={
                      <>
                        <span className="tnum">
                          {t(`shape.${row.shape}`)} · {seatsText(row)}
                        </span>
                        {/* on its own line, away from the ใช้งาน switch it has nothing to do with */}
                        <span className="mt-1 flex">{bookable(z, row)}</span>
                      </>
                    }
                    aside={
                      <>
                        <label className="flex items-center gap-2 text-sm text-muted-token">
                          {t('active')}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={row.active}
                            aria-label={`${t('active')} ${row.label}`}
                            className="tg"
                            onClick={() => void toggleTableActive(row)}
                            data-testid="table-active-toggle-mobile"
                          />
                        </label>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => editTable(z, row)}>
                          {tc('edit')}
                        </button>
                      </>
                    }
                  />
                ))}
                {!z.tables.length && <p className="px-4 py-2.5 text-center text-muted-token">—</p>}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-4 border-t border-line px-4 py-2 text-sm">
                <label className="flex items-center gap-2">
                  {t('colBookable')}
                  <button type="button" role="switch" aria-checked={z.customerBookable} aria-label={t('colBookable')} className="tg" onClick={() => void toggleZoneBookable(z)} />
                </label>
                <label className="flex items-center gap-2">
                  {t('active')}
                  <button type="button" role="switch" aria-checked={z.active} aria-label={`${t('active')} ${z.name}`} className="tg" onClick={() => void toggleZoneActive(z)} data-testid="zone-active-toggle" />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="note mt-3" data-testid="tables-choice-note" data-choice={tableChoice}>
        {t(tableChoice === 'customer' ? 'noteCustomer' : 'noteShop')}
      </p>
      <p className="note mt-1">{t('note')}</p>

      {zoneDialog && <ZoneDialog open branchId={branchId} initial={zoneDialog} onOpenChange={(v) => !v && setZoneDialog(null)} onSaved={refresh} />}
      {tableDialog && <TableDialog open branchId={branchId} zones={zoneOptions} initial={tableDialog} onOpenChange={(v) => !v && setTableDialog(null)} onSaved={refresh} />}
    </>
  )
}
