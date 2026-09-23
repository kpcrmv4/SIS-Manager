'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { updateBranch, type BranchDetailInput } from '@/lib/settings/branch-actions'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type BranchFormValue = {
  name: string
  active: boolean
  opensAt: string
  closesAt: string
  depositDays: number
  expiryNoticeDays: number
  withdrawalBlockedDays: string[]
  receiptHeader: string
  receiptFooter: string
  receiptCopies: number
}

/** The branch details form — used on /settings/branch and from the branches tab of /settings/users. */
export function BranchForm({ branchId, initial, onSaved }: { branchId: string; initial: BranchFormValue; onSaved?: () => void }) {
  const t = useTranslations('settingsBranch')
  const tc = useTranslations('common')
  const [v, setV] = useState(initial)
  const [pending, start] = useTransition()
  const weekdaysLong: string[] = t.raw('weekdaysLong')

  function toggleDay(day: (typeof WEEKDAYS)[number]) {
    setV((s) => ({
      ...s,
      withdrawalBlockedDays: s.withdrawalBlockedDays.includes(day) ? s.withdrawalBlockedDays.filter((d) => d !== day) : [...s.withdrawalBlockedDays, day],
    }))
  }

  function save() {
    start(async () => {
      const patch: BranchDetailInput = {
        name: v.name,
        active: v.active,
        opensAt: v.opensAt,
        closesAt: v.closesAt,
        depositDays: v.depositDays,
        expiryNoticeDays: v.expiryNoticeDays,
        withdrawalBlockedDays: v.withdrawalBlockedDays as BranchDetailInput['withdrawalBlockedDays'],
        receiptHeader: v.receiptHeader,
        receiptFooter: v.receiptFooter,
        receiptCopies: v.receiptCopies,
      }
      const res = await updateBranch(branchId, patch)
      if (!res.ok) {
        toast.error(tc('errorGeneric'))
        return
      }
      toast.success(tc('saved'))
      onSaved?.()
    })
  }

  return (
    <div className="card-surface flex flex-col gap-4 p-4" data-testid="branch-form">
      <div>
        <label className="label-base" htmlFor="bf-name">
          {t('name')}
        </label>
        <input id="bf-name" className="input-base" value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} maxLength={120} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{t('active')}</span>
        <button type="button" role="switch" aria-checked={v.active} aria-label={t('active')} className="tg" onClick={() => setV((s) => ({ ...s, active: !s.active }))} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-base" htmlFor="bf-opens">
            {t('opensAt')}
          </label>
          <input id="bf-opens" type="time" className="input-base tnum" value={v.opensAt.slice(0, 5)} onChange={(e) => setV((s) => ({ ...s, opensAt: e.target.value }))} />
        </div>
        <div>
          <label className="label-base" htmlFor="bf-closes">
            {t('closesAt')}
          </label>
          <input id="bf-closes" type="time" className="input-base tnum" value={v.closesAt.slice(0, 5)} onChange={(e) => setV((s) => ({ ...s, closesAt: e.target.value }))} />
        </div>
        <div>
          <label className="label-base" htmlFor="bf-deposit">
            {t('depositDays')}
          </label>
          <input id="bf-deposit" type="number" min={1} max={365} className="input-base tnum" value={v.depositDays} onChange={(e) => setV((s) => ({ ...s, depositDays: Number(e.target.value) }))} />
        </div>
        <div>
          <label className="label-base" htmlFor="bf-notice">
            {t('expiryNoticeDays')}
          </label>
          <input id="bf-notice" type="number" min={0} max={60} className="input-base tnum" value={v.expiryNoticeDays} onChange={(e) => setV((s) => ({ ...s, expiryNoticeDays: Number(e.target.value) }))} />
        </div>
      </div>

      <div>
        <label className="label-base">{t('withdrawalBlockedDays')}</label>
        <div className="days" role="group" aria-label={t('withdrawalBlockedDays')}>
          {WEEKDAYS.map((day, i) => (
            <button key={day} type="button" aria-pressed={v.withdrawalBlockedDays.includes(day)} onClick={() => toggleDay(day)}>
              {weekdaysLong[i]?.slice(0, 3)}
            </button>
          ))}
        </div>
        <p className="help-text">{t('withdrawalBlockedHelp')}</p>
      </div>

      <div className="sec-head">{t('receipt')}</div>
      <div>
        <label className="label-base" htmlFor="bf-rheader">
          {t('receiptHeader')}
        </label>
        <input id="bf-rheader" className="input-base" value={v.receiptHeader} onChange={(e) => setV((s) => ({ ...s, receiptHeader: e.target.value }))} maxLength={200} />
      </div>
      <div>
        <label className="label-base" htmlFor="bf-rfooter">
          {t('receiptFooter')}
        </label>
        <input id="bf-rfooter" className="input-base" value={v.receiptFooter} onChange={(e) => setV((s) => ({ ...s, receiptFooter: e.target.value }))} maxLength={200} />
      </div>
      <div>
        <label className="label-base" htmlFor="bf-rcopies">
          {t('receiptCopies')}
        </label>
        <input id="bf-rcopies" type="number" min={1} max={5} className="input-base tnum" value={v.receiptCopies} onChange={(e) => setV((s) => ({ ...s, receiptCopies: Number(e.target.value) }))} />
      </div>

      <button type="button" className="btn-primary self-start" disabled={pending} onClick={save} data-testid="branch-form-save">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {tc('save')}
      </button>
    </div>
  )
}
