/* SIS Manager service worker (P4-03).
 * Push only — there is deliberately NO fetch handler: nothing is cached, so no API
 * response or signed-in page can ever be served stale or to the wrong user. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'SIS Manager', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'SIS Manager'
  const shown = self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    tag: data.tag || undefined,
    // in-app paths only — '//host' is protocol-relative and would leave the app
    data: { url: typeof data.url === 'string' && /^\/(?![/\\])/.test(data.url) ? data.url : '/' },
  })
  event.waitUntil(Promise.all([shown, setIconCount(data.badge)]))
})

// the unread count on the app icon (R-042) — installed apps where the platform shows one
// (iPhone home-screen apps, Windows / macOS / ChromeOS); elsewhere a quiet no-op
function setIconCount(count) {
  if (!Number.isInteger(count) || count < 0 || !('setAppBadge' in self.navigator)) return Promise.resolve()
  return (count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge()).catch(() => undefined)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url)
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
