'use client'

import { useSyncExternalStore, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { setLocale } from '@/lib/auth/actions'

const noop = () => () => {}

export function AccountSettings({ locale }: { locale: 'th' | 'en' }) {
  const t = useTranslations('me')
  const tn = useTranslations('nav')
  const tc = useTranslations('common')
  const router = useRouter()
  const [pending, start] = useTransition()
  const { theme: rawTheme, setTheme } = useTheme()
  // theme is unknown on the server; pressed state only after hydration
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const theme = mounted ? rawTheme : undefined

  function changeLocale(next: 'th' | 'en') {
    if (next === locale) return
    start(async () => {
      const res = await setLocale(next)
      if (!res.ok) return void toast.error(tc('errorGeneric'))
      router.refresh()
    })
  }

  const seg = (on: boolean) => `tab ${on ? 'on' : ''}`

  return (
    <section className="card-surface flex flex-col gap-4 p-4">
      <div>
        <div className="label-base">{t('language')}</div>
        <div className="flex gap-1.5" role="group" aria-label={t('language')}>
          <button type="button" className={seg(locale === 'th')} aria-pressed={locale === 'th'} disabled={pending} onClick={() => changeLocale('th')}>
            {t('languageTh')}
          </button>
          <button type="button" className={seg(locale === 'en')} aria-pressed={locale === 'en'} disabled={pending} onClick={() => changeLocale('en')} data-testid="locale-en">
            {t('languageEn')}
          </button>
        </div>
      </div>
      <div>
        <div className="label-base">{t('theme')}</div>
        <div className="flex gap-1.5" role="group" aria-label={t('theme')}>
          <button type="button" className={seg(theme === 'light')} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
            {tn('themeLight')}
          </button>
          <button type="button" className={seg(theme === 'dark')} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
            {tn('themeDark')}
          </button>
        </div>
      </div>
    </section>
  )
}
