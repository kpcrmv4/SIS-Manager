import type { Role } from '@/lib/auth/actor'

/**
 * Who is told about what (R-042): the roles of the branch each kind of notification goes to —
 * owners in every branch. Mirrors private.notify_on_deposit_event, notify_on_booking and
 * notify_on_booking_cancel; P4-03-08 proves the database agrees.
 */
export const NOTIFICATION_ROLES = {
  deposit_received: ['bar', 'owner'],
  deposit_withdrawal_requested: ['staff', 'bar', 'owner'],
  deposit_requested: ['staff', 'bar', 'owner'],
  booking_pending: ['bar', 'owner'],
  booking_new: ['bar', 'owner'],
  booking_cancelled: ['bar', 'owner'],
} as const satisfies Record<string, readonly Role[]>

export type NotificationKind = keyof typeof NOTIFICATION_ROLES

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_ROLES) as NotificationKind[]

export function kindsFor(role: Role): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((k) => (NOTIFICATION_ROLES[k] as readonly Role[]).includes(role))
}

/** The `bell.kinds.*` text of a notification row: its own kind, the test push, or the catch-all. */
export function textKind(kind: string): NotificationKind | 'test' | 'other' {
  if (kind === 'test') return 'test'
  return (NOTIFICATION_KINDS as string[]).includes(kind) ? (kind as NotificationKind) : 'other'
}
