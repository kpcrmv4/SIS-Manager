'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { ListSkeleton } from '@/components/ui/states'
import { ErrorRetry } from '@/components/ui/error-retry'
import { getDepositScanSummary, type DepositScanSummary } from '@/lib/deposit/scan-summary'
import { depositBadgeSpec, badgeText, remainingText } from '@/lib/deposit/format'
import { formatShortDate } from '@/lib/date'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ok'; summary: DepositScanSummary }

/** Scan result for a deposit receipt QR/code — item, customer, remaining, expiry, status + open/withdraw. */
export function ScanResultDeposit({ depositId }: { depositId: string; onDone: () => void }) {
  const t = useTranslations('scan')
  const td = useTranslations('deposit')
  const tRoot = useTranslations()
  const [state, setState] = useState<State>({ status: 'loading' })

  async function load() {
    setState({ status: 'loading' })
    try {
      const res = await getDepositScanSummary(depositId)
      setState(res.ok ? { status: 'ok', summary: res.data } : { status: 'error' })
    } catch {
      setState({ status: 'error' })
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load()
  }, [depositId])

  if (state.status === 'loading') return <ListSkeleton rows={1} />
  if (state.status === 'error') return <ErrorRetry onRetry={() => void load()} />

  const { summary } = state
  const spec = depositBadgeSpec(summary)
  const canWithdraw = summary.status === 'in_store' || summary.status === 'pending_withdrawal'

  return (
    <div className="card-surface p-4" data-testid="scan-result-deposit">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold">{t('resultDeposit')}</div>
        <Badge tone={spec.tone}>{badgeText(tRoot, spec)}</Badge>
      </div>
      <dl className="kv">
        <dt>{td('customer')}</dt>
        <dd>{summary.customerName}</dd>
        <dt>{tRoot('deposits.colItem')}</dt>
        <dd>{summary.itemName}</dd>
        <dt>{tRoot('deposits.colRemaining')}</dt>
        <dd className="num">{remainingText(tRoot, summary.remainingQty, summary.remainingPercent)}</dd>
        <dt>{td('expires')}</dt>
        <dd className="num">{summary.expiresAt ? formatShortDate(summary.expiresAt) : tRoot('deposits.noExpiry')}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/deposits/${summary.id}`} className="btn-secondary" data-testid="scan-deposit-open">
          {t('openDeposit')}
        </Link>
        {canWithdraw && (
          <Link href={`/deposits/${summary.id}?open=withdraw`} className="btn-primary" data-testid="scan-deposit-withdraw">
            {td('actionWithdraw')}
          </Link>
        )}
      </div>
    </div>
  )
}
