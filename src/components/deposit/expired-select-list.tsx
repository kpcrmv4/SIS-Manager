'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { EmptyTab } from './empty-tab'
import { DisposeDialog } from './dispose-dialog'
import { depositBadgeSpec, badgeText, remainingText } from '@/lib/deposit/format'
import { formatShortDate } from '@/lib/date'
import type { DepositListRow } from '@/lib/deposit/list'

/** The "หมดอายุ รอจำหน่ายออก" tab body — multi-select + bulk dispose (bar/owner); staff sees a note. */
export function ExpiredSelectList({
  rows,
  role,
  branchId,
  locale,
  emptyTitle,
  emptyBody,
}: {
  rows: DepositListRow[]
  role: 'staff' | 'bar' | 'owner'
  branchId: string
  locale: 'th' | 'en'
  emptyTitle: string
  emptyBody?: string
}) {
  const t = useTranslations('deposits')
  const tRoot = useTranslations()
  const [selected, setSelected] = useState<string[]>(rows.map((r) => r.id))
  const [open, setOpen] = useState(false)
  const barOrOwner = role !== 'staff'

  if (!rows.length) return <EmptyTab title={emptyTitle} body={emptyBody} />

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div>
      <div className="warnbox mb-3">{t('expiredHelp')}</div>
      <div className="panel">
        {rows.map((r) => {
          const spec = depositBadgeSpec(r)
          return (
            <label key={r.id} className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 md:px-4">
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                onChange={() => toggle(r.id)}
                aria-label={t('select')}
                data-testid={`expired-select-${r.id}`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold leading-6 text-ink">
                  {r.itemName} · {r.customerName}
                </div>
                <div className="truncate text-sm leading-5 text-muted-token">
                  {t('expiredMeta', {
                    code: r.code,
                    date: r.expiresAt ? formatShortDate(r.expiresAt, locale) : '—',
                    left: remainingText(tRoot, r.remainingQty, r.remainingPercent),
                    notified: r.expiredNoticeSentAt ? t('expiredNotified') : t('expiredNotNotified'),
                  })}
                </div>
              </div>
              <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
            </label>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {barOrOwner ? (
          <>
            <span className="note mr-auto">{t('selected', { count: selected.length })}</span>
            <button type="button" className="btn-danger" onClick={() => setOpen(true)} disabled={!selected.length} data-testid="dispose-open">
              {t('disposeCount', { count: selected.length })}
            </button>
          </>
        ) : (
          <span className="note">{t('disposeOnlyBar')}</span>
        )}
      </div>
      {barOrOwner && <DisposeDialog
          open={open}
          onOpenChange={setOpen}
          depositIds={selected}
          summary={rows.filter((r) => selected.includes(r.id)).map((r) => ({ id: r.id, code: r.code, item: r.itemName, bottles: r.remainingQty }))}
          branchId={branchId}
          onDone={() => setSelected([])}
        />}
    </div>
  )
}
