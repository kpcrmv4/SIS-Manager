import { getTranslations } from 'next-intl/server'

/** P1-05 LIFF route skeleton — header + empty body in the customer's language. */
export async function LiffPlaceholder({ locale, title, body }: { locale: string; title: string; body: string }) {
  const t = await getTranslations({ locale, namespace: 'cx' })
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <header className="border-b border-cx-line px-4.5 pb-3 pt-4.5">
        <h1 className="cx-serif text-[17px] font-semibold">{t(title)}</h1>
        <p className="text-xs text-cx-muted">{t('shell.shop')}</p>
      </header>
      <div className="flex-1 p-4">
        <div className="cx-card text-center text-sm text-cx-muted">{t(body)}</div>
      </div>
    </main>
  )
}
