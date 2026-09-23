import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts')

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // the dev badge sits on top of the bottom nav in every phone screenshot
  devIndicators: false,
  // Next 16 dev blocks cross-origin chunk requests; without this, 127.0.0.1 never hydrates.
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.localhost'],
  outputFileTracingIncludes: {
    '/api/print-server/setup': ['./print-server/**/*'],
    // the PDF report reads its Thai font from disk (never from a Host-derived URL)
    '/api/reports/export': ['./public/fonts/**/*'],
  },
  headers: async () => [
    {
      source: '/sw.js',
      headers: [
        { key: 'Service-Worker-Allowed', value: '/' },
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      ],
    },
  ],
}

export default withNextIntl(nextConfig)
