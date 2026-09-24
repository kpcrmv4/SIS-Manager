import { Crown } from 'lucide-react'

/** ลูกค้า VIP (R-048) — the gold badge tone with a crown, on the customers list and page. */
export function VipBadge({ label }: { label: string }) {
  return (
    <span className="chip flex-none gap-1 bg-gold-bg text-gold-ink ring-gold-ring" data-testid="customer-vip-badge">
      <Crown className="size-3" aria-hidden />
      {label}
    </span>
  )
}
