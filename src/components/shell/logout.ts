'use client'

/** Ends this device's session, then replace() so Back cannot return to a signed-in page. */
export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } finally {
    window.location.replace('/login')
  }
}
