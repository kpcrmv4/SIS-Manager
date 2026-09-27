'use client'

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, ChevronDown, Loader2, Store } from 'lucide-react'
import { setBranch } from '@/lib/auth/actions'
import type { BranchRef } from '@/lib/auth/actor'

/**
 * Branch picker: a styled listbox (a native <select> popup ignores the theme and renders as
 * plain white rows). Click outside or Escape closes it; arrows move, Enter picks.
 */
export function BranchSwitcher({
  branches,
  branch,
  variant,
}: {
  branches: BranchRef[]
  branch: BranchRef | null
  /** top = the phone's top bar: the name alone, a picker only when there is more than one */
  variant: 'sidebar' | 'sheet' | 'top'
}) {
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  function pick(id: string) {
    setOpen(false)
    if (id === branch?.id) return
    start(async () => {
      const res = await setBranch(id)
      if (!res.ok) {
        toast.error(tc('errorGeneric'))
        return
      }
      router.refresh()
    })
  }

  function toggle() {
    setFocus(Math.max(0, branches.findIndex((b) => b.id === branch?.id)))
    setOpen((v) => !v)
  }

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocus((i) => Math.min(branches.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocus((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(branches[focus].id)
    }
  }

  const dark = variant === 'sidebar'
  const top = variant === 'top'
  if (top && branches.length <= 1) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 px-1 text-sm font-semibold text-ink" data-testid="branch-switcher-current">
        <Store className="size-4 flex-none text-muted-token" aria-hidden />
        <span className="truncate">{branch?.name}</span>
      </span>
    )
  }
  return (
    <div ref={root} className="relative" data-testid="branch-switcher">
      <button
        type="button"
        onClick={toggle}
        onKeyDown={onKey}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${t('switchBranch')}: ${branch?.name ?? ''}`}
        className={`flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors ${
          top
            ? 'max-w-full bg-surface-2 font-semibold text-ink hover:bg-line-soft'
            : dark
              ? 'w-full bg-sidebar-hover text-sidebar-title hover:brightness-110'
              : 'w-full border border-line bg-card text-ink'
        }`}
      >
        <Store className={`size-4 flex-none ${dark ? 'text-sidebar-fg-dim' : 'text-muted-token'}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate" data-testid="branch-switcher-current">{branch?.name}</span>
        {pending ? (
          <Loader2 className="size-4 flex-none animate-spin" aria-hidden />
        ) : (
          <ChevronDown className={`size-4 flex-none transition-transform ${open ? 'rotate-180' : ''} ${dark ? 'text-sidebar-fg-dim' : 'text-muted-token'}`} aria-hidden />
        )}
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('switchBranch')}
          className={`absolute top-[calc(100%+6px)] z-40 max-h-72 overflow-auto rounded-xl border border-line bg-card p-1 text-ink shadow-[0_12px_32px_rgba(0,0,0,.28)] ${
            top ? 'left-0 w-[min(18rem,calc(100vw-1.5rem))]' : 'inset-x-0'
          }`}
        >
          {branches.map((b, i) => {
            const selected = b.id === branch?.id
            return (
              <li
                key={b.id}
                role="option"
                aria-selected={selected}
                data-value={b.id}
                onPointerEnter={() => setFocus(i)}
                onClick={() => pick(b.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${i === focus ? 'bg-surface-2' : ''} ${selected ? 'font-semibold' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {selected && <Check className="size-4 flex-none text-brand" aria-hidden />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
