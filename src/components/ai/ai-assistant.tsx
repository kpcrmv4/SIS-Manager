'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowUp, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { AiMarkdown } from './ai-markdown'

type Turn = { role: 'user' | 'assistant'; text: string; error?: string }
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
export function AiAssistant({ className, branchName }: { className: string; branchName: string }) {
  const t = useTranslations('ai')
  const pathname = usePathname()
  const search = useSearchParams()
  const path = `${pathname}${search.toString() ? `?${search.toString()}` : ''}`
  const [open, setOpen] = useState(false)
  // the panel never renders on the server, so reading sessionStorage up front cannot mismatch
  const [turns, setTurns] = useState<Turn[]>(() => (typeof window === 'undefined' ? [] : load()))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<'thinking' | 'looking' | null>(null)
  const [fetched, setFetched] = useState<{ path: string; chips: Chip[] } | null>(null)
  const chips = fetched?.path === path ? fetched.chips : null
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // the quick questions follow the page, and are fetched fresh each time the panel opens
  useEffect(() => {
    if (!open) return
    let live = true
    fetch(`/api/ai/chips?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : { chips: [] }))
      .then((d: { chips: Chip[] }) => live && setFetched({ path, chips: d.chips ?? [] }))
      .catch(() => live && setFetched({ path, chips: [] }))
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
      let failed = false
      const show = (patch: Partial<Turn>) =>
        setTurns(() => {
          const next = [...history, { role: 'assistant' as const, text: answer, ...patch }]
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
          body: JSON.stringify({ messages: history.map(({ role, text }) => ({ role, text })), path, pageTitle: document.querySelector('main h1')?.textContent ?? null }),
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
            const ev = JSON.parse(chunk.slice(6)) as { type: string; text?: string; error?: string }
            if (ev.type === 'text' && ev.text) {
              answer += ev.text
              setBusy('thinking')
              show({})
            } else if (ev.type === 'tool') setBusy('looking')
            else if (ev.type === 'error') {
              failed = true
              show({ error: ev.error ?? 'ai_unreachable' })
            }
          }
        }
        if (!failed && !answer.trim()) show({ error: 'ai_unreachable' })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') show({ error: 'ai_unreachable' })
      } finally {
        setBusy(null)
        abortRef.current = null
      }
    },
    [busy, turns, path],
  )

  function reset() {
    abortRef.current?.abort()
    setTurns([])
    keep([])
  }

  const chipText = (c: Chip) => (t.has(`chips.${c.key}`) ? t(`chips.${c.key}`, c.values ?? {}) : null)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={className} aria-label={t('open')} title={t('open')} data-testid="ai-open">
          <Sparkles className="size-4.5" aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/40" />
        <Dialog.Content
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
              <div className="mb-3 rounded-lg bg-surface-2 p-3 text-sm text-ink-2">
                <p>{t('intro')}</p>
                <p className="mt-1 text-xs text-muted-token">{t('readOnly')}</p>
              </div>
            )}
            <div className="flex flex-col gap-3">
              {turns.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="ml-8 self-end rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-on-brand" data-testid="ai-user">
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className="mr-4 rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2" data-testid="ai-answer">
                    {m.text && <AiMarkdown text={m.text} onNavigate={() => setOpen(false)} />}
                    {m.error && (
                      <p className="text-sm text-urgent" data-testid="ai-error" data-error={m.error}>
                        {t.has(`errors.${m.error}`) ? t(`errors.${m.error}`) : t('errors.ai_unreachable')}
                      </p>
                    )}
                  </div>
                ),
              )}
              {busy && (
                <p className="flex items-center gap-2 text-xs text-muted-token" data-testid="ai-busy">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
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
