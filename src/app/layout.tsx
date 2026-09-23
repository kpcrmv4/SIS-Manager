import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_NAME } from '@/lib/constants'
import './globals.css'

export const metadata: Metadata = {
  title: APP_NAME,
  icons: { icon: '/favicon-32x32.png', apple: '/apple-touch-icon.png' },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
