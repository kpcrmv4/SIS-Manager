'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { Moon, Sun } from 'lucide-react'

const noop = () => () => {}

/** Row-shaped toggle used in the เพิ่มเติม sheet and the sidebar. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useTranslations('nav')
  const { resolvedTheme, setTheme } = useTheme()
  // The server cannot know the theme: render the light icon until hydrated, or the markup mismatches.
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} className={className} data-testid="theme-toggle">
      {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
      <span>{t('toggleTheme')}</span>
    </button>
  )
}
