/**
 * The RPCs raise named exceptions (BAR_ONLY, DEPOSIT_EXPIRED, table_taken …). PostgREST
 * hands them back as `error.message`. This is the one place that turns them into a
 * catalog key under `errors.*` (staff) or `cx.errors.*` (customer) — constraint and
 * exception names are an API, so a rename in SQL must change this list too.
 */
export const DB_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BAR_ONLY',
  'NOT_FOUND',
  'BAD_STATE',
  'PHOTO_REQUIRED',
  'BAD_QUANTITY',
  'BRANCH_INACTIVE',
  'LEVELS_MISMATCH',
  'BAD_LEVEL',
  'NO_BOTTLES',
  'BAD_BOTTLES',
  'ALREADY_REQUESTED',
  'WITHDRAW_BLOCKED_DAY',
  'DEPOSIT_EXPIRED',
  'WITHDRAWAL_CHANGED',
  'ONE_DEPOSIT_ONLY',
  'VIP_NO_EXPIRY',
  'BAD_DAYS',
  'NOT_EXPIRED',
  'NOT_YOURS',
  'NOT_LINKED',
  'TERMS_REQUIRED',
  'WRONG_NIGHT',
  'BAD_ZONE',
  'BAD_TABLE',
  'CUSTOMER_REQUIRED',
  'CODE_EXHAUSTED',
  'BAD_COUNT',
  'TERMS_IMMUTABLE',
  'ZONE_OTHER_BRANCH',
  'BAD_RANGE',
  'BAD_TYPE',
  'NO_GROUP',
  'NO_CUSTOMER_KEY',
  'NOT_LATE',
  'ALREADY_LINKED',
  'NO_LIFF',
  'line_disabled',
  'past',
  'closed_weekday',
  'blackout',
  'too_far',
  'cutoff',
  'bad_slot',
  'party_size',
  'zone_not_bookable',
  'full',
  'table_taken',
  'table_required',
  'table_not_bookable',
  'table_seats',
  'TABLE_OTHER_BRANCH',
  'cancel_too_late',
] as const

export type DbErrorCode = (typeof DB_ERROR_CODES)[number] | 'unknown'

/** Extract the named exception from a Supabase/PostgREST error (message is exactly the name). */
export function dbErrorCode(error: { message?: string; code?: string } | null | undefined): DbErrorCode {
  if (!error) return 'unknown'
  const msg = (error.message ?? '').trim()
  const hit = DB_ERROR_CODES.find((c) => msg === c || msg.startsWith(`${c}:`) || msg.startsWith(`${c} `))
  if (hit) return hit
  if (error.code === '42501') return 'FORBIDDEN'
  if (error.code === 'PGRST116') return 'NOT_FOUND'
  return 'unknown'
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: DbErrorCode | 'invalid' | 'unauthenticated' }
