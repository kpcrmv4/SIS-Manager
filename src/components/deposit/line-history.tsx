import { getTranslations } from 'next-intl/server'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { getSupabaseServer } from '@/lib/supabase/server'
import { formatShortDate, formatTime, type AppLocale } from '@/lib/date'

type Row = { id: string; kind: string; status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'; created_at: string; sent_at: string | null }

const KINDS = new Set(['deposit_confirmed', 'deposit_rejected', 'withdraw_completed', 'withdraw_rejected', 'expiry_soon', 'expired', 'disposed'])
const TONE = { queued: 'info', sending: 'progress', sent: 'done', failed: 'urgent', skipped: 'pending' } as const

/**
 * What LINE told this customer about this deposit (owner request, replacing the "ส่ง" badge that read
 * like a button): each message, whether it went out, when — newest first, folded until opened.
 */
export async function LineHistory({ depositId, linked, locale }: { depositId: string; linked: boolean; locale: AppLocale }) {
  const t = await getTranslations('deposit.lineHistory')
  if (!linked) return null
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('deposit_line_history', { p_deposit: depositId })
  if (error) return null
  const rows = (data ?? []) as Row[]

  return (
    <details className="group" data-testid="line-history">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="text-muted-token">{t('title')}</span>
        <span className="flex items-center gap-1.5 text-ink-2 tnum">
          {t('count', { count: rows.length })}
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-token">{t('empty')}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line-soft">
          {rows.map((r) => {
            const at = r.sent_at ?? r.created_at
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid="line-history-row" data-kind={r.kind} data-status={r.status}>
                <span className="min-w-0">
                  <span className="block truncate text-ink">{t(`kind.${KINDS.has(r.kind) ? r.kind : 'other'}`)}</span>
                  <span className="block text-xs text-muted-token tnum">
                    {formatShortDate(at, locale)} · {formatTime(at, locale)}
                  </span>
                </span>
                <Badge tone={TONE[r.status] ?? 'pending'}>{t(`status.${r.status}`)}</Badge>
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}
