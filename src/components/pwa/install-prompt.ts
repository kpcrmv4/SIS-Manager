/**
 * The browser's offer to install the app (R-042). Chrome, Edge and Samsung Internet fire
 * `beforeinstallprompt` once per page load — usually before anyone opens /me — so this module
 * starts listening as soon as the staff layout loads it (ServiceWorkerRegister) and /me reads
 * the offer from here. Safari and Firefox never fire it: /me explains the manual way instead.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let offer: InstallEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // no mini bar from the browser — the button on /me is the way in
    offer = e as InstallEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    installed = true
    emit()
  })
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const installOffer = (): InstallEvent | null => offer
export const installedHere = (): boolean => installed

/** Opens the browser's own install prompt. An offer can be used once, whatever the answer. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = offer
  if (!e) return 'unavailable'
  offer = null
  emit()
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') {
    installed = true
    emit()
  }
  return outcome
}
