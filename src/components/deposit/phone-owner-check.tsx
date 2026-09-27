'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2, UserCheck, X } from 'lucide-react'
import { lookupPhoneOwner, type PhoneOwner } from '@/lib/deposit/link-qr'

/** What the staff said about a phone that is a LINE customer's (R-059). */
export type PhoneChoice = null | 'owner' | 'denied' | 'shared'

const digitsOf = (phone: string) => phone.replace(/\D/g, '')
const DEBOUNCE_MS = 400

/**
 * Who owns the phone being typed: looked up once the number has 9+ digits, a stale answer (for a
 * number since changed) dropped (L-017). `ensure()` answers for the current number right now, so a
 * fast submit can't skip the question.
 */
export function usePhoneOwner(branchId: string, phone: string) {
  const [owner, setOwner] = useState<PhoneOwner | null>(null)
  const [checking, setChecking] = useState(false)
  const checkedFor = useRef<string | null>(null)
  const seq = useRef(0)

  const run = useCallback(
    async (value: string): Promise<PhoneOwner | null> => {
      const mine = ++seq.current
      if (digitsOf(value).length < 9) {
        checkedFor.current = value
        setOwner(null)
        setChecking(false)
        return null
      }
      setChecking(true)
      const res = await lookupPhoneOwner(branchId, value)
      if (mine !== seq.current) return null
      const found = res.ok ? res.data : null
      checkedFor.current = value
      setOwner(found)
      setChecking(false)
      return found
    },
    [branchId],
  )

  useEffect(() => {
    // a new number clears the last answer at once, then asks after a pause in typing
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOwner(null)
    checkedFor.current = null
    const timer = setTimeout(() => void run(phone), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [phone, run])

  const ensure = useCallback(async () => (checkedFor.current === phone ? owner : run(phone)), [phone, owner, run])
  return { owner, checking, ensure }
}

/** The card under the phone field: ask, then show what was chosen, with a way back. */
export function PhoneOwnerCard({
  owner,
  checking,
  choice,
  onChoose,
  error,
}: {
  owner: PhoneOwner | null
  checking: boolean
  choice: PhoneChoice
  onChoose: (c: PhoneChoice) => void
  error?: string
}) {
  const t = useTranslations('depositForm')
  if (checking && !owner) {
    return (
      <p className="help-text flex items-center gap-1.5" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {t('checking')}
      </p>
    )
  }
  if (!owner) return null
  const name = owner.name ?? 'LINE'

  if (choice === 'owner' || choice === 'shared') {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 rounded-[10px] border border-line-soft bg-surface-2 px-3 py-2 text-sm" data-testid="phone-owner-chosen" data-choice={choice}>
        <span className="flex min-w-0 items-center gap-2 text-ink">
          {choice === 'owner' ? <Check className="size-4 flex-none text-status-done" aria-hidden /> : <X className="size-4 flex-none text-muted-token" aria-hidden />}
          <span className="min-w-0">{choice === 'owner' ? t('ownerChosen', { name }) : t('ownerSharedChosen')}</span>
        </span>
        <button type="button" className="btn-ghost btn-sm flex-none" onClick={() => onChoose(null)} data-testid="phone-owner-change">
          {t('ownerChange')}
        </button>
      </div>
    )
  }

  if (choice === 'denied') {
    return (
      <div className="mt-2 text-sm" data-testid="phone-owner-denied">
        <p className="text-urgent">{t('ownerDenied')}</p>
        <button type="button" className="mt-1 text-xs text-muted-token underline underline-offset-2" onClick={() => onChoose('shared')} data-testid="phone-owner-shared">
          {t('ownerShared')}
        </button>
        {error && <p className="help-text text-urgent">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-[10px] border border-line bg-surface-2 p-3 text-sm" data-testid="phone-owner-card">
      <div className="flex items-start gap-2">
        <UserCheck className="mt-0.5 size-4 flex-none text-ink-2" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs text-muted-token">{t('ownerTitle')}</p>
          <p className="font-semibold text-ink" data-testid="phone-owner-name">
            {t('ownerLine', { name })}
          </p>
          {owner.open > 0 && <p className="text-xs text-muted-token tnum">{t('ownerOpen', { count: owner.open })}</p>}
        </div>
      </div>
      <p className="mt-2 text-ink-2">{t('ownerAsk')}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-primary btn-sm flex-1" onClick={() => onChoose('owner')} data-testid="phone-owner-yes">
          {t('ownerYes')}
        </button>
        <button type="button" className="btn-secondary btn-sm flex-1" onClick={() => onChoose('denied')} data-testid="phone-owner-no">
          {t('ownerNo')}
        </button>
      </div>
      {error && <p className="help-text text-urgent">{error}</p>}
    </div>
  )
}
