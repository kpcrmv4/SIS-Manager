import { daysUntil, formatShortDate, type AppLocale } from '@/lib/date'
import type { Database } from '@/types/database'
import type { BadgeTone } from '@/components/ui/badge'

export type DepositStatus = Database['public']['Enums']['deposit_status']
export type BottleStatus = Database['public']['Enums']['bottle_status']

export type Translator = (key: string, values?: Record<string, string | number | Date>) => string

export type BadgeSpec = { tone: BadgeTone; key: string; count?: number }

/**
 * One rule set for every "what colour/label does this deposit's badge get" question —
 * list rows (desktop table + mobile cards) and the detail header all call this, so the
 * three surfaces never drift (CLAUDE.md §3 badge tones, DESIGN.md deposit rules).
 */
export function depositBadgeSpec(
  row: { status: DepositStatus; isVip: boolean; expiresAt: string | null },
  opts: { short?: boolean; now?: Date } = {},
): BadgeSpec {
  if (row.isVip && (row.status === 'in_store' || row.status === 'pending_withdrawal' || row.status === 'pending_confirm' || row.status === 'requested')) {
    return { tone: 'gold', key: opts.short ? 'status.vipShort' : 'status.vip' }
  }
  if (row.status === 'in_store' || row.status === 'pending_withdrawal') {
    if (row.expiresAt) {
      const days = daysUntil(row.expiresAt, opts.now)
      if (days <= 2) return { tone: 'urgent', key: 'status.daysLeft', count: Math.max(days, 0) }
      if (days <= 7) return { tone: 'progress', key: 'status.daysLeft', count: days }
    }
    // a withdrawal asked for is still in store, but it must not read as the ones nobody asked for (R-047)
    return { tone: row.status === 'pending_withdrawal' ? 'violet' : 'done', key: `status.deposit.${row.status}` }
  }
  if (row.status === 'expired') {
    const days = row.expiresAt ? Math.max(-daysUntil(row.expiresAt, opts.now), 0) : 0
    return { tone: 'urgent', key: 'status.daysOver', count: days }
  }
  if (row.status === 'pending_confirm') return { tone: 'progress', key: 'status.deposit.pending_confirm' }
  if (row.status === 'requested') return { tone: 'info', key: 'status.deposit.requested' }
  return { tone: 'pending', key: `status.deposit.${row.status}` }
}

/** Render a BadgeSpec with any translator (root — keys are fully qualified). */
export function badgeText(t: Translator, spec: BadgeSpec): string {
  return spec.count !== undefined ? t(spec.key, { count: spec.count }) : t(spec.key)
}

/** "{count} ขวด · {percent}%" vs "{count} ขวด · ยังไม่เปิด" when every remaining bottle is still sealed (100%). */
export function remainingText(t: Translator, remainingQty: number, remainingPercent: number): string {
  if (remainingQty > 0 && remainingPercent >= 100) return t('deposits.remainingSealed', { count: remainingQty })
  return t('deposits.remaining', { count: remainingQty, percent: Math.round(remainingPercent) })
}

export function bottleStateKey(status: BottleStatus): string {
  return `status.bottle.${status}`
}

/** 0% → consumed, 100% → sealed, otherwise opened (DESIGN.md ฝากเหล้า rules). */
export function bottleStatusForLevel(level: number): BottleStatus {
  if (level <= 0) return 'consumed'
  if (level >= 100) return 'sealed'
  return 'opened'
}

/**
 * One deposit_events row → its history-line text. The payload shape is whatever the RPC
 * that logged it built (supabase/migrations/20260923150000_deposits.sql `log_event` calls) —
 * this is the one place that knows all of them, so a payload-shape change only breaks here.
 */
export function eventText(t: Translator, e: { action: string; payload: Record<string, unknown> }, locale: AppLocale): string {
  const p = e.payload
  switch (e.action) {
    case 'requested':
      return t('deposit.event.requested')
    case 'received':
      return t('deposit.event.received', { count: Number(p.count) || 0 })
    case 'confirmed': {
      const levels = Array.isArray(p.levels) ? (p.levels as number[]) : []
      return t('deposit.event.confirmed', { levels: levels.map((l) => `${Math.round(l)}%`).join(' · ') })
    }
    case 'rejected':
      return t('deposit.event.rejected', { reason: String(p.reason ?? '') })
    case 'withdrawal_requested':
      return t('deposit.event.withdrawal_requested', { count: Number(p.count) || 0 })
    case 'withdrawal_completed': {
      const bottles = Array.isArray(p.bottles) ? (p.bottles as number[]).join(', ') : ''
      return p.type === 'take_home'
        ? t('deposit.event.withdrawal_completed_home', { bottles })
        : t('deposit.event.withdrawal_completed', { bottles, table: String(p.table ?? '') })
    }
    case 'withdrawal_rejected':
      return t('deposit.event.withdrawal_rejected', { reason: String(p.reason ?? '') })
    case 'extended':
      return t('deposit.event.extended', { date: p.expires_at ? formatShortDate(String(p.expires_at), locale) : '' })
    case 'vip_on':
      return t('deposit.event.vip_on')
    case 'vip_off':
      return t('deposit.event.vip_off')
    case 'expired':
      return t('deposit.event.expired')
    case 'disposed':
      return t('deposit.event.disposed', { reason: String(p.reason ?? '') })
    case 'printed':
      return t('deposit.event.printed')
    case 'line_linked':
      return t('deposit.event.line_linked')
    case 'cancelled':
      return t('deposit.event.cancelled')
    default:
      return e.action
  }
}
