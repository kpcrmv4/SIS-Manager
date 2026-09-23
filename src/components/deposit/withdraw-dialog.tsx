'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { ActionDialog } from './action-dialog'
import { requestWithdrawal } from '@/lib/deposit/actions'
import type { DepositBottle } from '@/lib/deposit/detail'

/** Any role: pick bottles, in-store or take-home, an optional table — creates a withdrawal request. */
export function WithdrawDialog({
  open,
  onOpenChange,
  depositId,
  bottles,
  pendingBottleIds,
  defaultTable,
  blockedTonight,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  depositId: string
  bottles: DepositBottle[]
  pendingBottleIds: Set<string>
  defaultTable: string
  blockedTonight: boolean
}) {
  const t = useTranslations('withdrawDialog')
  const td = useTranslations('deposit')
  const ts = useTranslations('status')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [selected, setSelected] = useState<string[]>([])
  const [type, setType] = useState<'in_store' | 'take_home'>(blockedTonight ? 'take_home' : 'in_store')
  const [table, setTable] = useState(defaultTable)
  const [pending, start] = useTransition()

  const pickable = bottles.filter((b) => b.status !== 'consumed' && !pendingBottleIds.has(b.id))

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function submit() {
    start(async () => {
      const res = await requestWithdrawal({ depositId, bottleIds: selected, type, table })
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('done'))
      onOpenChange(false)
    })
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending || !selected.length} data-testid="withdraw-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('submit')}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label className="label-base">{t('pickBottles')}</label>
          <div className="space-y-1.5" role="group" aria-label={t('pickBottles')}>
            {pickable.map((b) => (
              <label key={b.id} className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-sm">
                <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} data-testid={`withdraw-bottle-${b.bottleNo}`} />
                <span className="flex-1">{td('bottleN', { n: b.bottleNo })}</span>
                <span className="tnum text-muted-token">{td('bottleLevel', { percent: Math.round(b.remainingPercent), state: ts(`bottle.${b.status}`) })}</span>
              </label>
            ))}
          </div>
        </div>

        {blockedTonight && (
          <div className="warnbox" data-testid="withdraw-blocked-notice">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            <span>{t('blockedDay')}</span>
          </div>
        )}

        <div>
          <label className="label-base">{t('type')}</label>
          <div className="flex gap-2">
            <label className="flex-1">
              <input
                type="radio"
                name="withdraw-type"
                className="sr-only"
                checked={type === 'in_store'}
                disabled={blockedTonight}
                onChange={() => setType('in_store')}
              />
              <span
                className={`btn-secondary block w-full text-center ${type === 'in_store' ? 'border-brand text-brand' : ''} ${blockedTonight ? 'opacity-50' : ''}`}
              >
                {t('typeInStore')}
              </span>
            </label>
            <label className="flex-1">
              <input type="radio" name="withdraw-type" className="sr-only" checked={type === 'take_home'} onChange={() => setType('take_home')} />
              <span className={`btn-secondary block w-full text-center ${type === 'take_home' ? 'border-brand text-brand' : ''}`}>{t('typeTakeHome')}</span>
            </label>
          </div>
        </div>

        <div>
          <label className="label-base" htmlFor="withdraw-table">
            {t('table')}
          </label>
          <input id="withdraw-table" className="input-base" value={table} onChange={(e) => setTable(e.target.value)} />
        </div>
      </div>
    </ActionDialog>
  )
}
