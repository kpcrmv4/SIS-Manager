'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bell, BellRing, CalendarCheck, CalendarClock, CalendarMinus, ClipboardCheck, GlassWater, Loader2, MessageSquarePlus, type LucideIcon } from 'lucide-react'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { ErrorRetry } from '@/components/ui/error-retry'
import { EmptyState, ListSkeleton } from '@/components/ui/states'
import { useLive } from '@/components/realtime/live-provider'
import { appEnv, noSubscribe } from '@/components/pwa/platform'
import { usePush } from '@/components/pwa/use-push'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { formatShortDate, formatTime } from '@/lib/date'
import { alertSoundOn, chime, clearSystemNotifications, notificationParts, setAlertSound } from './notification-text'

// each kind wears its work's icon and hue — the same as the LINE switches and the /deposits filter cards (R-047)
const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  deposit_received: { icon: ClipboardCheck, tone: 'bg-status-progress-bg text-status-progress' },
  deposit_withdrawal_requested: { icon: GlassWater, tone: 'bg-status-violet-bg text-status-violet' },
  deposit_requested: { icon: MessageSquarePlus, tone: 'bg-status-info-bg text-status-info' },
  booking_pending: { icon: CalendarClock, tone: 'bg-status-progress-bg text-status-progress' },
  booking_new: { icon: CalendarCheck, tone: 'bg-status-done-bg text-status-done' },
  booking_cancelled: { icon: CalendarMinus, tone: 'bg-urgent-bg text-urgent' },
}
const PLAIN = { icon: Bell, tone: 'bg-surface-2 text-ink-2' }

type Row = { id: string; kind: string; payload: Record<string, unknown>; link: string | null; read_at: string | null; created_at: string }

const LIMIT = 30

/**
 * P4-02 in-app bell: own notifications only (RLS), newest first. A bottom sheet on a
 * phone, a centred panel from `nav:` up. Clicking an item marks it read and follows
 * its link; the badge is live through LiveProvider's `user:<id>` channel.
 */
export function BellButton({ userId, className, showLabel = true }: { userId: string; className: string; showLabel?: boolean }) {
  const t = useTranslations('bell')
  const { unread, refreshUnread, notificationTick } = useLive()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? t('openWithCount', { count: unread }) : t('title')}
        data-testid="bell-button"
      >
        <span className="relative flex-none">
          <Bell className="size-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-urgent px-1 text-center text-[10px] font-bold leading-4 text-white tnum" data-testid="bell-count">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
        {showLabel && <span className="truncate">{t('title')}</span>}
      </button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title={t('title')}>
        {open && <BellList userId={userId} tick={notificationTick} onChanged={refreshUnread} onNavigate={() => setOpen(false)} />}
      </ResponsiveDialog>
    </>
  )
}

function BellList({ userId, tick, onChanged, onNavigate }: { userId: string; tick: number; onChanged: () => void; onNavigate: () => void }) {
  const t = useTranslations('bell')
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  // the installed app whose notifications are still off offers them right here (R-043)
  const installed = useSyncExternalStore(noSubscribe, appEnv, () => null) === 'installed'
  const push = usePush()
  const offerPush = installed && push.state === 'off'
  const pushBlocked = installed && push.state === 'denied'

  const load = useCallback(async () => {
    setFailed(false)
    const { data, error } = await getSupabaseBrowser()
      .from('notifications')
      .select('id, kind, payload, link, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(0, LIMIT - 1)
    if (error) {
      setFailed(true)
      return
    }
    setRows((data ?? []) as Row[])
  }, [userId])

  useEffect(() => {
    // Fetch on open and on each new notification: load() clears the error flag synchronously
    // before it asks the database — not the effect reacting to its own render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, tick])

  async function openRow(r: Row) {
    if (!r.read_at) {
      const { error } = await getSupabaseBrowser().from('notifications').update({ read_at: new Date().toISOString() }).eq('id', r.id)
      if (!error) {
        clearSystemNotifications([r.id])
        onChanged()
      }
    }
    onNavigate()
    // in-app paths only — '//host' is protocol-relative and would leave the app
    if (r.link && /^\/(?![/\\])/.test(r.link)) router.push(r.link)
  }

  async function markAll() {
    const { error } = await getSupabaseBrowser().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null)
    if (error) {
      setFailed(true)
      return
    }
    clearSystemNotifications()
    onChanged()
    void load()
  }

  if (failed) return <ErrorRetry onRetry={() => void load()} />
  if (!rows) return <ListSkeleton rows={4} />

  const unread = rows.some((r) => !r.read_at)
  const toolbar = (
    <div className="mb-2 flex flex-col gap-2">
      <SoundToggle label={t('sound')} />
      {pushBlocked && (
        <p className="text-xs text-urgent" data-testid="bell-push-blocked">
          {t('pushBlocked')}
        </p>
      )}
      {(offerPush || unread) && (
        <div className="flex flex-wrap justify-end gap-2">
          {offerPush && (
            <button type="button" className="btn-primary" onClick={push.enable} disabled={push.pending} data-testid="bell-push-enable">
              {push.pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BellRing className="size-4" aria-hidden />}
              {t('enablePush')}
            </button>
          )}
          {unread && (
            <button type="button" className="btn-ghost" onClick={() => void markAll()} data-testid="bell-mark-all">
              {t('markAllRead')}
            </button>
          )}
        </div>
      )}
    </div>
  )

  if (!rows.length)
    return (
      <>
        {toolbar}
        <EmptyState icon={Bell} message={t('empty')} />
      </>
    )

  const parts = (r: Row) => notificationParts(t as never, r.kind, r.payload, (ymd) => formatShortDate(`${ymd}T00:00:00+07:00`))

  return (
    <div data-testid="bell-list">
      {toolbar}
      <ul className="panel">
        {rows.map((r) => (
          <li key={r.id} className="border-b border-line-soft last:border-b-0">
            <button
              type="button"
              onClick={() => void openRow(r)}
              className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2"
              data-testid="bell-item"
              data-unread={r.read_at ? 'false' : 'true'}
              data-kind={r.kind}
            >
              {(() => {
                const look = LOOK[r.kind] ?? PLAIN
                return (
                  <span className={`relative flex size-9 flex-none items-center justify-center rounded-[10px] ${look.tone} ${r.read_at ? 'opacity-55' : ''}`} aria-hidden>
                    <look.icon className="size-4.5" />
                    {!r.read_at && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-urgent ring-2 ring-card" />}
                  </span>
                )
              })()}
              <span className="min-w-0 flex-1">
                {(() => {
                  const { title, lines } = parts(r)
                  return (
                    <>
                      <span className={`block truncate text-sm leading-5 ${r.read_at ? 'text-ink-2' : 'font-semibold text-ink'}`} data-testid="bell-item-title">
                        {title}
                      </span>
                      {lines.map((l, i) => (
                        <span key={i} className={`block truncate text-[13px] leading-5 ${r.read_at ? 'text-muted-token' : 'text-ink-2'}`} data-testid="bell-item-line">
                          {l}
                        </span>
                      ))}
                    </>
                  )
                })()}
                <span className="mt-0.5 block text-xs text-muted-token tnum">
                  {formatShortDate(r.created_at)} {formatTime(r.created_at)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** R-066: a chime with the toast for a new job — this device's choice, off until turned on. */
function SoundToggle({ label }: { label: string }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    // this device's setting, read once the page is in the browser
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(alertSoundOn())
  }, [])
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line-soft px-3 py-2" data-testid="bell-sound">
      <span className="text-sm text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className="tg"
        onClick={() => {
          const next = !on
          setOn(next)
          setAlertSound(next)
          if (next) chime()
        }}
        data-testid="bell-sound-switch"
      />
    </div>
  )
}
