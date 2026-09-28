'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowUp, RotateCcw, Sparkles, X } from 'lucide-react'
import { AiMarkdown } from './ai-markdown'
import { AiProposalCard, type CardOutcome } from './ai-proposal-card'
import { AiWelcome } from './ai-welcome'
import type { Proposal } from '@/lib/ai/proposal-types'
import { focusDialogItself } from '@/lib/dialog-focus'

type Card = { proposal: Proposal; outcome: CardOutcome }
type Turn = { role: 'user' | 'assistant'; text: string; error?: string; cards?: Card[] }

/** What the model is told about an earlier answer: its words, and what the person did with each card. */
function wire(t: Turn): { role: 'user' | 'assistant'; text: string } {
  const notes = (t.cards ?? []).map((c) => {
    const code = c.proposal.fields.find((f) => f.key === 'code')?.value ?? ''
    return `[card ${c.proposal.kind}${code ? ` ${code}` : ''}: ${c.outcome.state}${c.outcome.note ? ` ${c.outcome.note}` : ''}${c.outcome.error ? ` ${c.outcome.error}` : ''}]`
  })
  return { role: t.role, text: [t.text, ...notes].filter(Boolean).join('\n') || '…' }
}

type Chip = { key: string; values?: Record<string, string | number> }

const STORE = 'sis_ai_chat'

function load(): Turn[] {
  try {
    const raw = sessionStorage.getItem(STORE)
    const v = raw ? (JSON.parse(raw) as Turn[]) : []
    return Array.isArray(v) ? v.slice(-30) : []
  } catch {
    return []
  }
}
function keep(turns: Turn[]) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-30)))
  } catch {
    // private mode: the chat lasts this page only
  }
}

/**
 * R-070 — the assistant: a button on the top bar and a panel (a bottom sheet on a phone, a
 * side panel from `nav:` up). It knows the page it was opened on and offers quick questions
 * for that page and for what is waiting right now. Answers stream in.
 */
export function AiAssistant({ className, branchName, displayName, role }: { className: string; branchName: string; displayName: string; role: string }) {
  const t = useTranslations('ai')
  const pathname = usePathname()
  const search = useSearchParams()
  const path = `${pathname}${search.toString() ? `?${search.toString()}` : ''}`
  const [open, setOpen] = useState(false)
  // the panel never renders on the server, so reading sessionStorage up front cannot mismatch
  const [turns, setTurns] = useState<Turn[]>(() => (typeof window === 'undefined' ? [] : load()))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<'thinking' | 'looking' | null>(null)
  const [fetched, setFetched] = useState<{ path: string; chips: Chip[]; waiting: Chip[] } | null>(null)
  const chips = fetched?.path === path ? fetched.chips : null
  const waiting = fetched?.waiting ?? null
  // the dot on the button: something in the branch is waiting for someone (not just tonight's bookings)
  const hasWork = (waiting ?? []).some((w) => w.key !== 'tonightBookings')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // the quick questions follow the page and the welcome follows the branch: fetched when the page
  // changes (the button's dot) and fresh each time the panel opens — counts only, never the model
  useEffect(() => {
    let live = true
    fetch(`/api/ai/chips?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : { chips: [], waiting: [] }))
      .then((d: { chips?: Chip[]; waiting?: Chip[] }) => live && setFetched({ path, chips: d.chips ?? [], waiting: d.waiting ?? [] }))
      .catch(() => live && setFetched({ path, chips: [], waiting: [] }))
    return () => {
      live = false
    }
  }, [open, path])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns, busy])

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim().slice(0, 1000)
      if (!q || busy) return
      const history: Turn[] = [...turns.filter((x) => !x.error), { role: 'user', text: q }]
      let answer = ''
      const cards: Card[] = []
      let failed = false
      const show = (patch: Partial<Turn>) =>
        setTurns(() => {
          const next = [...history, { role: 'assistant' as const, text: answer, cards: [...cards], ...patch }]
          keep(next)
          return next
        })
      setTurns(history)
      setInput('')
      setBusy('thinking')
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history.map(wire), path, pageTitle: document.querySelector('main h1')?.textContent ?? null }),
          signal: ac.signal,
        })
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          show({ error: body.error ?? 'ai_unreachable' })
          return
        }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let cut: number
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, cut)
            buf = buf.slice(cut + 2)
            if (!chunk.startsWith('data: ')) continue
            const ev = JSON.parse(chunk.slice(6)) as { type: string; text?: string; error?: string; proposal?: Proposal }
            if (ev.type === 'text' && ev.text) {
              answer += ev.text
              setBusy('thinking')
              show({})
            } else if (ev.type === 'tool') setBusy('looking')
            else if (ev.type === 'proposal' && ev.proposal) {
              cards.push({ proposal: ev.proposal, outcome: { state: 'pending' } })
              show({})
            }
            else if (ev.type === 'error') {
              failed = true
              show({ error: ev.error ?? 'ai_unreachable' })
            }
          }
        }
        if (!failed && !answer.trim() && !cards.length) show({ error: 'ai_unreachable' })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') show({ error: 'ai_unreachable' })
      } finally {
        setBusy(null)
        abortRef.current = null
      }
    },
    [busy, turns, path],
  )

  function setOutcome(turn: number, card: number, outcome: CardOutcome) {
    setTurns((prev) => {
      const next = prev.map((t, i) => (i === turn && t.cards ? { ...t, cards: t.cards.map((c, j) => (j === card ? { ...c, outcome } : c)) } : t))
      keep(next)
      return next
    })
  }

  function reset() {
    abortRef.current?.abort()
    setTurns([])
    keep([])
  }

  const chipText = (c: Chip) => (t.has(`chips.${c.key}`) ? t(`chips.${c.key}`, c.values ?? {}) : null)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={`relative ${className}`} aria-label={hasWork ? t('openWaiting') : t('open')} title={t('open')} data-testid="ai-open">
          <Sparkles className="size-4.5" aria-hidden />
          {hasWork && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-card motion-safe:animate-pulse" aria-hidden data-testid="ai-dot" />}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/40" />
        <Dialog.Content onOpenAutoFocus={focusDialogItself}
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-31 flex h-[88dvh] flex-col rounded-t-[20px] bg-card text-ink shadow-[0_-8px_30px_rgba(0,0,0,.25)] nav:inset-y-0 nav:left-auto nav:right-0 nav:h-dvh nav:w-[420px] nav:rounded-none nav:rounded-l-[16px]"
          data-testid="ai-panel"
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-sm bg-line nav:hidden" aria-hidden />
          <header className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
            <span className="grid size-8 place-items-center rounded-full bg-brand-tint text-brand-on-tint" aria-hidden>
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold">{t('title')}</Dialog.Title>
              <p className="truncate text-xs text-muted-token">{t('scope', { branch: branchName })}</p>
            </div>
            {turns.length > 0 && (
              <button type="button" className="btn-ghost btn-sm" onClick={reset} aria-label={t('reset')} data-testid="ai-reset">
                <RotateCcw className="size-4" aria-hidden />
              </button>
            )}
            <Dialog.Close className="btn-ghost btn-sm" aria-label={t('close')}>
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </header>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="ai-messages">
            {turns.length === 0 && (
              <AiWelcome
                displayName={displayName}
                role={role}
                branchName={branchName}
                waiting={waiting}
                chipText={chipText}
                onAsk={(q) => void ask(q)}
                onExample={(q) => {
                  setInput(q)
                  inputRef.current?.focus()
                }}
              />
            )}
            <div className="flex flex-col gap-3">
              {turns.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="ml-8 self-end rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-on-brand motion-safe:animate-[ai-in_180ms_ease-out]" data-testid="ai-user">
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className="mr-4 rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2 motion-safe:animate-[ai-in_220ms_ease-out]" data-testid="ai-answer">
                    {m.text && <AiMarkdown text={m.text} onNavigate={() => setOpen(false)} />}
                    {m.cards?.map((c, j) => (
                      <div key={c.proposal.id} className="mt-2">
                        <AiProposalCard proposal={c.proposal} outcome={c.outcome} onOutcome={(o) => setOutcome(i, j, o)} onNavigate={() => setOpen(false)} />
                      </div>
                    ))}
                    {m.error && (
                      <p className="text-sm text-urgent" data-testid="ai-error" data-error={m.error}>
                        {t.has(`errors.${m.error}`) ? t(`errors.${m.error}`) : t('errors.ai_unreachable')}
                      </p>
                    )}
                  </div>
                ),
              )}
              {busy && (
                <p className="flex items-center gap-2 text-xs text-muted-token" data-testid="ai-busy" data-busy={busy}>
                  <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-2" aria-hidden>
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="size-1.5 rounded-full bg-muted-token motion-safe:animate-[ai-dot_1s_ease-in-out_infinite]" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                  {t(busy === 'looking' ? 'looking' : 'thinking')}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-line-soft px-3 pb-[calc(10px+env(safe-area-inset-bottom,0px))] pt-2.5">
            {!busy && chips && chips.length > 0 && (
              <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 pb-0.5" data-testid="ai-chips">
                {chips.map((c) => {
                  const text = chipText(c)
                  return text ? (
                    <button
                      key={c.key}
                      type="button"
                      className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand hover:text-ink"
                      onClick={() => void ask(text)}
                      data-testid="ai-chip"
                      data-key={c.key}
                    >
                      {text}
                    </button>
                  ) : null
                })}
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void ask(input)
              }}
            >
              <textarea
                ref={inputRef}
                className="input-base max-h-32 min-h-10 flex-1 resize-none py-2"
                rows={1}
                maxLength={1000}
                placeholder={t('placeholder')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void ask(input)
                  }
                }}
                data-testid="ai-input"
              />
              <button type="submit" className="btn-primary size-10 flex-none p-0" disabled={!input.trim() || busy !== null} aria-label={t('send')} data-testid="ai-send">
                <ArrowUp className="size-4" aria-hidden />
              </button>
            </form>
            <p className="mt-1.5 text-center text-[11px] text-muted-token">{t('disclaimer')}</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
