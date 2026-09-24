'use client'

import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Scanner } from '@/components/scan/scanner'
import { ScanResultBooking } from '@/components/booking/scan-result-booking'
import { ScanResultDeposit } from '@/components/deposit/scan-result-deposit'
import { lookupScan, type ScanHit } from '@/lib/scan/actions'
import { replaceQuery, uuidParam } from '@/lib/url-state'

/**
 * Scan or type → one lookup → the deposit or booking result slot (filled by workers A and B).
 * The result's id stays in the address (?b= booking · ?d= deposit, R-050): coming Back from the
 * customer or deposit page it opened shows the same result again.
 */
export function ScanPanel({ branchId }: { branchId: string }) {
  const t = useTranslations('scan')
  const tc = useTranslations('common')
  const sp = useSearchParams()
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState<ScanHit | null>(() => {
    const booking = uuidParam(sp.get('b'))
    const deposit = uuidParam(sp.get('d'))
    return booking ? { kind: 'booking', id: booking } : deposit ? { kind: 'deposit', id: deposit } : null
  })
  const [missed, setMissed] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const show = (next: ScanHit | null) => {
    setHit(next)
    replaceQuery({ b: next?.kind === 'booking' ? next.id : null, d: next?.kind === 'deposit' ? next.id : null })
  }

  function resolve(raw: string) {
    const q = raw.trim()
    if (!q) return
    setMissed(null)
    start(async () => {
      let r: ScanHit
      try {
        r = await lookupScan(branchId, q)
      } catch {
        r = { kind: 'error' }
      }
      if (r.kind === 'error') {
        show(null)
        toast.error(tc('errorTitle'), { action: { label: tc('retry'), onClick: () => resolve(q) } })
        return
      }
      show(r.kind === 'none' ? null : r)
      if (r.kind === 'none') setMissed(q)
    })
  }

  const reset = () => {
    show(null)
    setQuery('')
  }

  return (
    <div className="mx-auto max-w-[420px]">
      <Scanner onCode={resolve} paused={pending || hit !== null} />
      <div className="orline">{t('or')}</div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          resolve(query)
        }}
        className="flex flex-col gap-2.5"
      >
        <label className="flex items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2">
          <Search className="size-4 text-muted-token" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            className="min-w-0 flex-1 bg-transparent outline-none"
            data-testid="scan-input"
          />
        </label>
        <button type="submit" className="btn-primary w-full" disabled={pending || !query.trim()}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('submit')}
        </button>
      </form>
      <div className="mt-4" aria-live="polite">
        {missed && !pending && (
          <p className="rounded-md bg-status-progress-bg px-3 py-2 text-sm text-status-progress" role="status">
            {t('notFound', { q: missed })}
          </p>
        )}
        {hit?.kind === 'deposit' && <ScanResultDeposit depositId={hit.id} onDone={reset} />}
        {hit?.kind === 'booking' && <ScanResultBooking bookingId={hit.id} branchId={branchId} onDone={reset} />}
      </div>
    </div>
  )
}
