'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { Moon, Sun } from 'lucide-react'

const noop = () => () => {}

/** Theme toggle — an icon button in the top bar (label kept for screen readers). */
export function ThemeToggle({ className = '', showLabel = true }: { className?: string; showLabel?: boolean }) {
  const t = useTranslations('nav')
  const { resolvedTheme, setTheme } = useTheme()
  // The server cannot know the theme: render the light icon until hydrated, or the markup mismatches.
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className={className}
      aria-label={showLabel ? undefined : t('toggleTheme')}
      title={showLabel ? undefined : t('toggleTheme')}
      data-testid="theme-toggle"
    >
      {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
      {showLabel && <span>{t('toggleTheme')}</span>}
    </button>
  )
}
