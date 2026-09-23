'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bell } from 'lucide-react'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { ErrorRetry } from '@/components/ui/error-retry'
import { EmptyState, ListSkeleton } from '@/components/ui/states'
import { useLive } from '@/components/realtime/live-provider'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { formatShortDate, formatTime } from '@/lib/date'

type Row = { id: string; kind: string; payload: Record<string, unknown>; link: string | null; read_at: string | null; created_at: string }

const KINDS = ['deposit_received', 'deposit_withdrawal_requested', 'deposit_requested', 'booking_pending'] as const
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
  if (!rows.length) return <EmptyState icon={Bell} message={t('empty')} />

  const text = (r: Row) => {
    const p = r.payload ?? {}
    const v = (k: string) => (p[k] == null ? '' : String(p[k]))
    const kind = (KINDS as readonly string[]).includes(r.kind) ? r.kind : 'other'
    return t(`kinds.${kind}` as never, { item: v('item'), customer: v('customer'), table: v('table') || '—', name: v('name'), party: v('party'), time: v('time'), code: v('code') } as never)
  }

  return (
    <div data-testid="bell-list">
      {rows.some((r) => !r.read_at) && (
        <div className="mb-2 flex justify-end">
          <button type="button" className="btn-ghost" onClick={() => void markAll()} data-testid="bell-mark-all">
            {t('markAllRead')}
          </button>
        </div>
      )}
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
