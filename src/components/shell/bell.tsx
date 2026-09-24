'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bell, BellRing, Loader2 } from 'lucide-react'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { ErrorRetry } from '@/components/ui/error-retry'
import { EmptyState, ListSkeleton } from '@/components/ui/states'
import { useLive } from '@/components/realtime/live-provider'
import { appEnv, noSubscribe } from '@/components/pwa/platform'
import { usePush } from '@/components/pwa/use-push'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { formatShortDate, formatTime } from '@/lib/date'
import { textKind } from '@/lib/push/kinds'

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
      if (!error) onChanged()
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
    onChanged()
    void load()
  }

  if (failed) return <ErrorRetry onRetry={() => void load()} />
  if (!rows) return <ListSkeleton rows={4} />

  const unread = rows.some((r) => !r.read_at)
  const toolbar = (offerPush || pushBlocked || unread) && (
    <div className="mb-2 flex flex-col gap-2">
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

  const text = (r: Row) => {
    const p = r.payload ?? {}
    const v = (k: string) => (p[k] == null ? '' : String(p[k]))
    return t(`kinds.${textKind(r.kind)}` as never, { item: v('item'), customer: v('customer'), table: v('table') || '—', name: v('name'), party: v('party'), time: v('time'), code: v('code') } as never)
  }

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
            >
              <span className={`mt-2 size-2 flex-none rounded-full ${r.read_at ? 'bg-transparent' : 'bg-brand'}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm leading-5 ${r.read_at ? 'text-ink-2' : 'font-semibold text-ink'}`}>{text(r)}</span>
                <span className="block text-xs text-muted-token tnum">
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
