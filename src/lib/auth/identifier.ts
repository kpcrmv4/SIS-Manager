import { STAFF_EMAIL_DOMAIN } from '@/lib/constants'

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/

/**
 * Staff type a username or an e-mail. A username maps to the synthetic
 * address `<username>@staff.sis.local`, which only ever exists server-side.
 * Returns null for input that is neither.
 */
export function identifierToEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (!v || v.length > 254) return null
  if (v.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
  return USERNAME_RE.test(v) ? `${v}@${STAFF_EMAIL_DOMAIN}` : null
}

export function usernameEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`
}

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`))
}
