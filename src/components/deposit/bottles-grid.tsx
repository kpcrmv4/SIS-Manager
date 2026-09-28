import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import type { DepositBottle } from '@/lib/deposit/detail'

/** Server-rendered — the bottles panel never needs client interactivity. */
export async function BottlesGrid({ bottles, total, pendingBottleIds = [] }: { bottles: DepositBottle[]; total: number; pendingBottleIds?: string[] }) {
  const t = await getTranslations('deposit')
  const ts = await getTranslations('status')
  const remaining = bottles.filter((b) => b.status !== 'consumed').length

  return (
    <div className="card-surface p-4">
      <h2 className="sec-head">
        <span>{t('bottlesTitle')}</span>
        <Badge tone="pending">{t('bottlesLeft', { left: remaining, total })}</Badge>
      </h2>
      <div className="bottles">
        {bottles.map((b) => (
          <div key={b.id} className={`bottle ${b.status === 'consumed' ? 'used' : ''}`} data-testid={`bottle-${b.bottleNo}`}>
            <div className="glass">
              <i style={{ height: `${b.status === 'consumed' ? 0 : Math.round(b.remainingPercent)}%` }} />
            </div>
            <b>{t('bottleN', { n: b.bottleNo })}</b>
            {pendingBottleIds.includes(b.id) && (
              <span className="my-0.5 flex justify-center" data-testid={`bottle-${b.bottleNo}-pending`}>
                <Badge tone="violet">{t('bottlePendingWithdraw')}</Badge>
              </span>
            )}
            <div className="num">
              {b.status === 'consumed' ? ts('bottle.consumed') : t('bottleLevel', { percent: Math.round(b.remainingPercent), state: ts(`bottle.${b.status}`) })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
