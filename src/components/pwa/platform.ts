/**
 * Where the staff app is running (R-042), read in the browser: already installed (opened from
 * the home screen), iPhone / iPad Safari (installs by hand; push only once installed), an in-app
 * browser such as LINE's (cannot install at all), or any other browser.
 */
export type AppEnv = 'installed' | 'ios' | 'in-app' | 'browser'

export function appEnv(): AppEnv {
  const nav = navigator as Navigator & { standalone?: boolean }
  if (window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true) return 'installed'
  const ua = nav.userAgent
  if (/\bLine\/|FBAN|FBAV|Instagram/i.test(ua)) return 'in-app'
  // iPadOS reports itself as a Mac — a touch screen gives it away
  if (/iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) return 'ios'
  return 'browser'
}

/** For useSyncExternalStore: the environment never changes while the page is open. */
export const noSubscribe = () => () => {}
