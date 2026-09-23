import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowUpFromLine,
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  CircleCheck,
  CircleX,
  Crown,
  GlassWater,
  Hourglass,
  Link2,
  MessageSquarePlus,
  PackagePlus,
  Printer,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/states'
import { eventText, type Translator } from '@/lib/deposit/format'
import { bangkokDate, formatShortDate, formatTime, type AppLocale } from '@/lib/date'
import { branchHref, type FeedItem } from '@/lib/reports/dashboard-view'
import { Block } from './block'

type Tone = 'done' | 'progress' | 'urgent' | 'info' | 'pending'

const ICON: Record<string, LucideIcon> = {
  requested: MessageSquarePlus,
  received: PackagePlus,
  confirmed: CircleCheck,
  rejected: CircleX,
  withdrawal_requested: ArrowUpFromLine,
  withdrawal_completed: GlassWater,
  withdrawal_rejected: CircleX,
  extended: CalendarPlus,
  vip_on: Crown,
  vip_off: Crown,
  expired: Hourglass,
  disposed: Trash2,
  printed: Printer,
  line_linked: Link2,
  cancelled: Ban,
  booking_requested: CalendarClock,
  booking_created: CalendarCheck,
  booking_confirmed: CalendarCheck,
  booking_arrived: UserCheck,
  booking_no_show: UserX,
  booking_cancelled: CalendarX,
  booking_rejected: CalendarX,
}

const TONE: Record<string, Tone> = {
  confirmed: 'done',
  withdrawal_completed: 'done',
  line_linked: 'done',
  booking_created: 'done',
  booking_confirmed: 'done',
  booking_arrived: 'done',
  requested: 'progress',
  withdrawal_requested: 'progress',
  booking_requested: 'progress',
  rejected: 'urgent',
  withdrawal_rejected: 'urgent',
  expired: 'urgent',
  disposed: 'urgent',
  cancelled: 'urgent',
  booking_no_show: 'urgent',
  booking_cancelled: 'urgent',
  booking_rejected: 'urgent',
}

const TONE_CLS: Record<Tone, string> = {
  done: 'bg-status-done-bg text-status-done',
  progress: 'bg-status-progress-bg text-status-progress',
  urgent: 'bg-urgent-bg text-urgent',
  info: 'bg-status-info-bg text-status-info',
  pending: 'bg-status-pending-bg text-status-pending',
}

/** Deposit events and booking changes of the last 7 days across the branches, newest first. */
export function ActivityFeed({
  items,
  t,
  tRoot,
  locale,
  working,
  showBranch,
  className = '',
}: {
  items: FeedItem[]
  /** the overview namespace */
  t: Translator
  /** the root translator — deposit events reuse the history wording (deposit.event.*) */
  tRoot: Translator
  locale: AppLocale
  working: string | null
  showBranch: boolean
  className?: string
}) {
  const today = bangkokDate()
  return (
    <Block title={t('feedTitle')} className={className} bodyClassName="" testId="overview-activity">
      {items.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={Activity} message={t('feedEmpty')} />
        </div>
      ) : (
        <ol>
          {items.map((e) => {
            const Icon = ICON[e.action] ?? Activity
            const tone = TONE[e.action] ?? 'info'
            const p = e.payload ?? {}
            const text =
              e.kind === 'deposit'
                ? eventText(tRoot, { action: e.action, payload: p }, locale)
                : t(`feed.${e.action}`, { party: Number(p.party) || 0, slot: String(p.slot ?? '') })
            const subject = e.kind === 'deposit' ? [e.item, e.customer].filter(Boolean).join(' · ') : [e.customer, e.code].filter(Boolean).join(' · ')
            const who = e.actor_kind === 'customer' ? t('feedByCustomer') : e.actor_kind === 'system' ? t('feedBySystem') : e.actor
            const when = bangkokDate(e.at) === today ? formatTime(e.at, locale) : `${formatShortDate(e.at, locale)} ${formatTime(e.at, locale)}`
            const detail = [subject, who, showBranch ? e.branch : null].filter(Boolean).join(' · ')
            const href =
              e.kind === 'deposit' && e.deposit_id
                ? branchHref(e.branch_id, `/deposits/${e.deposit_id}`, working)
                : branchHref(e.branch_id, `/bookings?night=${e.night ?? ''}&view=list`, working)
            return (
              <li key={e.key} className="border-b border-line-soft last:border-b-0">
                <Link href={href} className="flex items-center gap-3 px-4 py-2 transition-colors duration-100 hover:bg-surface-2" data-testid="feed-item" data-kind={e.kind} data-action={e.action}>
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${TONE_CLS[tone]}`} aria-hidden>
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{text}</span>
                      <time dateTime={e.at} className="shrink-0 text-xs text-muted-token tnum">
                        {when}
                      </time>
                    </span>
                    <span className="block truncate text-xs text-muted-token">{detail}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </Block>
  )
}
