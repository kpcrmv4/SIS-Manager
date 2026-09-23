'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { errorText } from './error-text'
import type { Deposit } from './my-bottles-client'
import { customerFetch, useCxSession } from './session-context'

/** "ขอเบิกเหล้า" bottom sheet (P2-C2): pick bottles, in-store/take-home, an optional table. */
export function WithdrawSheet({
  deposit,
  blockedToday,
  onClose,
  onDone,
}: {
  deposit: Deposit
  blockedToday: boolean
  onClose: () => void
  onDone: () => void
}) {
  const t = useTranslations('cx')
  const session = useCxSession()
  const bottles = deposit.deposit_bottles.filter((b) => b.status !== 'consumed')
  const [picked, setPicked] = useState<string[]>([])
  const [type, setType] = useState<'in_store' | 'take_home'>(blockedToday ? 'take_home' : 'in_store')
  const [table, setTable] = useState('')
  const [pending, setPending] = useState(false)

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const submit = async () => {
    if (picked.length === 0) {
      toast.error(errorText(t, 'NO_BOTTLES'))
      return
    }
    setPending(true)
    try {
      const res = await customerFetch(`/api/customer/withdrawals?branch=${session.branch.code}`, session, {
        method: 'POST',
        body: JSON.stringify({ deposit_id: deposit.id, bottle_ids: picked, type, table: table || undefined }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(errorText(t, body.error))
        return
      }
      toast.success(t('withdraw.sent'))
      onDone()
    } catch {
      toast.error(t('shell.errorGeneric'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="cx fixed inset-x-0 bottom-0 z-31 max-h-[85vh] overflow-auto rounded-t-[20px] bg-cx-card px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-2 text-cx-ink shadow-[0_-8px_30px_rgba(0,0,0,.35)]"
        >
          <Dialog.Title className="cx-serif px-1 pb-2 pt-3 text-[15px] font-semibold">{t('withdraw.title')}</Dialog.Title>
          <div className="mx-auto mb-3 h-1 w-10 rounded-sm bg-cx-line" aria-hidden />

          <p className="cx-label">{t('withdraw.pick')}</p>
          <div className="mb-3 flex flex-col gap-2">
            {bottles.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.includes(b.id)} onChange={() => toggle(b.id)} data-testid={`cx-bottle-${b.bottle_no}`} />
                {t('withdraw.bottleN', { n: b.bottle_no, percent: b.remaining_percent })}
              </label>
            ))}
          </div>

          <p className="cx-label">{t('withdraw.type')}</p>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              disabled={blockedToday}
              aria-pressed={type === 'in_store'}
              onClick={() => setType('in_store')}
              className="cx-btn ghost flex-1"
              data-testid="cx-type-in-store"
            >
              {t('withdraw.typeInStore')}
            </button>
            <button type="button" aria-pressed={type === 'take_home'} onClick={() => setType('take_home')} className="cx-btn ghost flex-1" data-testid="cx-type-take-home">
              {t('withdraw.typeTakeHome')}
            </button>
          </div>
          {blockedToday && (
            <p className="mb-3 text-xs text-cx-warn" data-testid="cx-blocked-notice">
              {t('withdraw.blockedDay')}
            </p>
          )}

          <label className="mb-4 block">
            <span className="cx-label">{t('withdraw.table')}</span>
            <input className="cx-input" value={table} onChange={(e) => setTable(e.target.value)} placeholder={t('withdraw.tablePlaceholder')} maxLength={20} />
          </label>

          <button type="button" className="cx-btn" disabled={pending} onClick={() => void submit()} data-testid="cx-withdraw-submit">
            {t('withdraw.submit')}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
