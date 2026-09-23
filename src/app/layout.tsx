import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { IBM_Plex_Sans_Thai, Noto_Serif_Thai } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { APP_NAME } from '@/lib/constants'
import { Providers } from './providers'
import './globals.css'

const sans = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-thai',
  display: 'swap',
})

const serif = Noto_Serif_Thai({
  subsets: ['thai', 'latin'],
  weight: ['600', '700'],
  variable: '--font-serif-thai',
  display: 'swap',
})

export const metadata: Metadata = {
  title: APP_NAME,
  icons: { icon: '/favicon-32x32.png', apple: '/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  // Staff pages get only the staff catalog; the LIFF layout provides the `cx` half itself.
  const { cx: _customer, ...staffMessages } = await getMessages()
  void _customer
  return (
    <html lang={locale} suppressHydrationWarning className={`${sans.variable} ${serif.variable}`}>
      <body>
        <NextIntlClientProvider messages={staffMessages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
