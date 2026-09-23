import type { MetadataRoute } from 'next'
import { APP_NAME } from '@/lib/constants'

/** P4-03 — staff PWA. Colours are the Minimal palette tokens (--brand-sidebar, --canvas). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: 'SIS',
    description: 'ฝากเหล้าและจองโต๊ะ',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F6F4F3',
    theme_color: '#221619',
    lang: 'th',
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
