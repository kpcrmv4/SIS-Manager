'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslations } from 'next-intl'
import { Check, Languages } from 'lucide-react'
import { toast } from 'sonner'
import { CUSTOMER_LOCALES, type CustomerLocale } from '@/lib/i18n/config'
import { customerFetch, type CxSession } from './session-context'

/** Native names on purpose — a language picker names each language in itself, not in the current UI language. */
const NATIVE_NAME: Record<CustomerLocale, string> = { th: 'ไทย', en: 'English', zh: '中文', ko: '한국어' }

/** Language picker (P2-C1): PATCH /api/customer/profile, then refresh so SSR re-reads the cookie + catalog. */
export function LocaleSheet({ session, current }: { session: CxSession; current: CustomerLocale }) {
  const t = useTranslations('cx')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const pick = (locale: CustomerLocale) => {
    if (locale === current) {
      setOpen(false)
      return
    }
    startTransition(async () => {
      try {
        const res = await customerFetch(`/api/customer/profile?branch=${session.branch.code}`, session, {
          method: 'PATCH',
          body: JSON.stringify({ locale }),
        })
        if (!res.ok) {
          toast.error(t('shell.errorGeneric'))
          return
        }
        setOpen(false)
        router.refresh()
      } catch {
        toast.error(t('shell.errorGeneric'))
      }
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label={t('shell.language')} data-testid="cx-locale-trigger" className="grid size-9 place-items-center rounded-full text-cx-muted">
          <Languages className="size-5" aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="cx fixed inset-x-0 bottom-0 z-31 rounded-t-[20px] bg-cx-card px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-2 text-cx-ink shadow-[0_-8px_30px_rgba(0,0,0,.35)]"
        >
          <Dialog.Title className="cx-serif px-1 pb-2 pt-3 text-[15px] font-semibold">{t('shell.language')}</Dialog.Title>
          <div className="mx-auto mb-1 h-1 w-10 rounded-sm bg-cx-line" aria-hidden />
          {CUSTOMER_LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              disabled={pending}
              data-testid={`cx-locale-${locale}`}
              onClick={() => pick(locale)}
              className="flex w-full items-center justify-between border-b border-cx-line py-3.25 text-[15px] last:border-b-0 disabled:opacity-60"
            >
              <span>{NATIVE_NAME[locale]}</span>
              {locale === current && <Check className="size-4 text-cx-gold" aria-hidden />}
            </button>
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
