import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { IBM_Plex_Sans_Thai, Noto_Serif_Thai } from 'next/font/google'
import { APP_NAME } from '@/lib/constants'
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  )
}
