/**
 * Thin client for the existing owner-only `POST /api/admin/users` route (P2-B3 UI
 * on top of an already-built API — see src/app/api/admin/users/route.ts for the
 * body shapes and error codes this maps 1:1).
 */
export type UsersApiError =
  | 'invalid'
  | 'password_too_short'
  | 'username_taken'
  | 'unavailable'
  | 'cannot_change_self'
  | 'not_found'
  | 'network'

export type UsersApiResult<T = undefined> = { ok: true; data: T } | { ok: false; error: UsersApiError }

async function call<T>(body: unknown): Promise<UsersApiResult<T>> {
  try {
    const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>
    if (!res.ok) return { ok: false, error: (json.error as UsersApiError) ?? 'unavailable' }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export function createStaffUser(input: { username: string; displayName: string; role: 'staff' | 'bar' | 'owner'; branchIds: string[]; password: string }) {
  return call<{ ok: true; id: string }>({ action: 'create', ...input })
}

export function updateStaffUser(input: { userId: string; displayName?: string; role?: 'staff' | 'bar' | 'owner'; active?: boolean; branchIds?: string[] }) {
  return call<{ ok: true }>({ action: 'update', ...input })
}

export function resetStaffPassword(userId: string, password: string) {
  return call<{ ok: true }>({ action: 'reset_password', userId, password })
}
