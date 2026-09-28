'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CheckCircle2, ChevronRight, Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { queuePrint, type PrintJobType } from '@/lib/deposit/print'
import type { CreatedDeposit } from '@/lib/deposit/actions'
import { PrintStatusBadge } from '@/components/print/print-status-badge'

/**
 * R-068: after a form with several liquors — every DEP code it made, each opening its deposit,
 * and one button that prints the receipt and / or label of all of them (both ticked by default).
 */
export function NewDepositSaved({ branchId, deposits, onAnother }: { branchId: string; deposits: CreatedDeposit[]; onAnother: () => void }) {
  const t = useTranslations('depositForm')
  const te = useTranslations('errors')
  const [types, setTypes] = useState<Record<PrintJobType, boolean>>({ receipt: true, label: true })
  const [printed, setPrinted] = useState(false)
  const [pending, start] = useTransition()

  function printAll() {
    const want = (['receipt', 'label'] as const).filter((k) => types[k])
    if (!want.length) return
    start(async () => {
      let queued = 0
      for (const d of deposits) {
        for (const type of want) {
          const res = await queuePrint(d.id, type)
          if (!res.ok) {
            toast.error(te(res.error))
            return
          }
          queued += 1
        }
      }
      setPrinted(true)
      toast.success(t('printQueued', { count: queued }))
    })
  }

  return (
    <div className="card-surface max-w-160 p-4" data-testid="deposit-saved">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-status-done-bg text-status-done" aria-hidden>
          <CheckCircle2 className="size-5" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-[15px] font-semibold leading-snug text-ink">{t('savedTitle', { count: deposits.length })}</h2>
          <p className="mt-0.5 text-sm text-muted-token">{t('savedBody')}</p>
        </div>
      </div>

      <ul className="mb-4 divide-y divide-line-soft rounded-lg border border-line-soft">
        {deposits.map((d) => (
          <li key={d.id}>
            <Link href={`/deposits/${d.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-surface-2" data-testid="deposit-saved-row" data-code={d.code}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-ink">
                  {d.item} × {d.quantity}
                </span>
                <span className="text-xs text-muted-token tnum">{d.code}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-token" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <div className="mb-4 rounded-lg bg-surface-2 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">{t('printAllTitle')}</span>
          <PrintStatusBadge branchId={branchId} />
        </div>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {(['receipt', 'label'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={types[k]} onChange={(e) => setTypes((v) => ({ ...v, [k]: e.target.checked }))} data-testid={`deposit-saved-print-${k}`} />
              {t(k === 'receipt' ? 'printReceipts' : 'printLabels')}
            </label>
          ))}
        </div>
        <button type="button" className="btn-secondary w-full" onClick={printAll} disabled={pending || (!types.receipt && !types.label)} data-testid="deposit-saved-print">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
          {printed ? t('printAgain') : t('printAll', { count: deposits.length })}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onAnother} data-testid="deposit-saved-another">
          {t('newAnother')}
        </button>
        <Link href="/deposits?tab=toConfirm" className="btn-primary" data-testid="deposit-saved-list">
          {t('toList')}
        </Link>
      </div>
    </div>
  )
}
