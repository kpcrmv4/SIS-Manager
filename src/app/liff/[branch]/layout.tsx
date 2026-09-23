import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { branchByCode } from '@/lib/customer/auth'
import { getCustomerLocale } from '@/lib/i18n/customer'
import { LiffShell } from '@/components/liff/liff-shell'

/**
 * Customer LIFF shell (P2-C1): resolves the branch and locale on the server, then hands off
 * to the client shell, which establishes the LIFF session, renders the header/tabs and only
 * then mounts `children` (every page under it reads the session from context — nothing here
 * ever renders without one). Night Bar is the default; `data-cx-theme="light"` switches to
 * cream, applied on the `.cx` element the shell itself renders.
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
      <LiffShell branch={{ code: branch.code, name: branch.name, liffId: branch.liff_id }} locale={locale}>
        {children}
      </LiffShell>
    </NextIntlClientProvider>
  )
}
