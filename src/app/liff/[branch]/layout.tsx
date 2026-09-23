import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { branchByCode } from '@/lib/customer/auth'
import { getCustomerLocale } from '@/lib/i18n/customer'

/**
 * Customer LIFF shell (P1-05 skeleton; P2-C1 adds LIFF init, auth and the locale/theme
 * pickers). Night Bar is the default; `data-cx-theme="light"` switches to cream.
 * The branch comes from the URL code and must exist and be active.
 */
export default async function LiffLayout({ children, params }: { children: ReactNode; params: Promise<{ branch: string }> }) {
  const { branch: code } = await params
  const branch = await branchByCode(code)
  if (!branch) notFound()
  const locale = await getCustomerLocale()
  const { cx } = await getMessages({ locale })
  return (
    <NextIntlClientProvider locale={locale} messages={{ cx }}>
      <div className="cx font-sans" lang={locale} data-branch={branch.code}>
        {children}
      </div>
    </NextIntlClientProvider>
  )
}
