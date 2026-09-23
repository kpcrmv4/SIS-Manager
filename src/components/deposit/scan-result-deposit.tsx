'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

/**
 * Scan result for a deposit receipt QR — P1-05 placeholder. Worker A (P2-A3) replaces the
 * body; the signature `{ depositId, onDone }` is the contract with the scan page.
 */
export function ScanResultDeposit({ depositId }: { depositId: string; onDone: () => void }) {
  const t = useTranslations('scan')
  return (
    <div className="card-surface p-4" data-testid="scan-result-deposit">
      <div className="mb-2 font-semibold">{t('resultDeposit')}</div>
      <Link href={`/deposits/${depositId}`} className="btn-primary">
        {t('openDeposit')}
      </Link>
    </div>
  )
}
