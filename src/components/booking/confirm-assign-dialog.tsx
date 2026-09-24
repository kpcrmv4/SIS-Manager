'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveDialog } from './responsive-dialog'
import { confirmBooking } from '@/lib/booking/actions'
import type { TableRow } from '@/lib/booking/queries'

/**
 * ยืนยัน + จัดโต๊ะ. A booking that already holds a table — the customer picked it (R-036) or bar
 * seated it early — starts on that table, and there is no "none": confirm_booking keeps a held
 * table when none is named, so offering none would say one thing and do another (R-054).
 */
export function ConfirmAssignDialog({
  open,
  onOpenChange,
  bookingId,
  tables,
  currentTableId = null,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  bookingId: string
  tables: Pick<TableRow, 'id' | 'label'>[]
  /** the table the booking holds now, if any */
  currentTableId?: string | null
  /** gets the table it is seated at now (or null) — the booking sheet shows it without a reload */
  onDone: (tableId: string | null) => void
}) {
  const t = useTranslations('booking')
  const tk = useTranslations('bookings')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const held = currentTableId && tables.some((tbl) => tbl.id === currentTableId) ? currentTableId : ''
  const [tableId, setTableId] = useState(held)
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await confirmBooking(bookingId, tableId || undefined)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(tc('saved'))
      const seated = tableId || currentTableId || null
      setTableId(held)
      onOpenChange(false)
      onDone(seated)
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={tk('confirmAssign')}>
      <label className="label-base" htmlFor="cad-table">
        {t('table')}
      </label>
      <select
        id="cad-table"
        className="input-base mb-4"
        value={tableId}
        onChange={(e) => setTableId(e.target.value)}
        data-testid="assign-table-select"
      >
        {!held && <option value="">{tc('none')}</option>}
        {tables.map((tbl) => (
          <option key={tbl.id} value={tbl.id}>
            {tbl.label}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button type="button" className="btn-primary" disabled={pending} onClick={submit} data-testid="assign-confirm-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tk('confirmAssign')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}
