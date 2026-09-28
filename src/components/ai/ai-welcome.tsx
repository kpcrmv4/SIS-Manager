'use client'

import { useTranslations } from 'next-intl'
import { BookOpen, ChevronRight, Search, Wand2 } from 'lucide-react'
import { bangkokParts } from '@/lib/date'

export type Chip = { key: string; values?: Record<string, string | number> }

function period(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

/**
 * R-072 — what the panel shows before the first question: a greeting by name and time of day,
 * what is waiting in the branch right now (each row asks about itself — counts, no AI call), and
 * three cards that say what the assistant can do (each fills in an example to edit).
 */
export function AiWelcome({
  displayName,
  role,
  branchName,
  waiting,
  chipText,
  onAsk,
  onExample,
}: {
  displayName: string
  role: string
  branchName: string
  waiting: Chip[] | null
  chipText: (c: Chip) => string | null
  onAsk: (q: string) => void
  onExample: (q: string) => void
}) {
  const t = useTranslations('ai')
  const p = period(bangkokParts().hour)
  const caps = [
    { key: 'howto', Icon: BookOpen, tone: 'bg-status-info-bg text-status-info' },
    { key: 'lookup', Icon: Search, tone: 'bg-status-violet-bg text-status-violet' },
    { key: 'act', Icon: Wand2, tone: 'bg-brand-tint text-brand-on-tint' },
  ] as const
  const rows = (waiting ?? []).map((c) => ({ c, text: chipText(c) })).filter((r): r is { c: Chip; text: string } => !!r.text)

  return (
    <div className="flex flex-col gap-4 motion-safe:animate-[ai-in_260ms_ease-out]" data-testid="ai-welcome" data-period={p}>
      <div>
        <p className="text-lg font-semibold leading-snug text-ink">{t(`greet.${p}`, { name: displayName })}</p>
        <p className="mt-0.5 text-sm text-muted-token">{t('greetSub', { role, branch: branchName })}</p>
      </div>

      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-token">{t('waitingTitle')}</h3>
        {waiting === null ? (
          <div className="flex flex-col gap-1.5" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-line-soft">
            {rows.map(({ c, text }) => (
              <li key={c.key} className="border-t border-line-soft first:border-t-0">
                <button
                  type="button"
                  onClick={() => onAsk(text)}
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2"
                  data-testid="ai-waiting"
                  data-key={c.key}
                >
                  <span className="min-w-0 flex-1 text-ink">{t(`waiting.${c.key}`)}</span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold tnum text-ink">{c.values?.count ?? ''}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-token" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-token">{t('capsTitle')}</h3>
        <div className="grid grid-cols-3 gap-2">
          {caps.map(({ key, Icon, tone }) => (
            <button
              key={key}
              type="button"
              onClick={() => onExample(t(`cap.${key}.example`))}
              className="flex flex-col items-start gap-1.5 rounded-lg border border-line bg-card p-2.5 text-left transition duration-150 hover:border-line-strong active:scale-[0.98]"
              data-testid="ai-cap"
              data-key={key}
            >
              <span className={`grid size-8 place-items-center rounded-[9px] ${tone}`} aria-hidden>
                <Icon className="size-4" />
              </span>
              <span className="text-[13px] font-semibold leading-snug text-ink">{t(`cap.${key}.title`)}</span>
              <span className="text-[11px] leading-snug text-muted-token">{t(`cap.${key}.sub`)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
