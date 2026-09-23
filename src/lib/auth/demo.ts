import 'server-only'
import type { Database } from '@/types/database'

type Role = Database['public']['Enums']['user_role']

/** Opt-in kill switch: unset (or anything but "true") = no button and a 404 route. */
export function demoLoginEnabled(): boolean {
  return process.env.ENABLE_DEMO_LOGIN === 'true'
}

export const DEMO_ROLES: readonly Role[] = ['staff', 'bar', 'owner']

/** Seeded demo accounts (P5-01). Passwords come from env, never from code. */
export const DEMO_USERNAME: Record<Role, string> = {
  staff: 'demo.staff',
  bar: 'demo.bar',
  owner: 'demo.owner',
}

export function demoPassword(role: Role): string | null {
  const v =
    role === 'owner' ? process.env.SEED_OWNER_PASSWORD : role === 'bar' ? process.env.SEED_BAR_PASSWORD : process.env.SEED_STAFF_PASSWORD
  return v && v.length >= 8 ? v : null
}
