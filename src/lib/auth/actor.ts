import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { getSupabaseServer } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type Role = Database['public']['Enums']['user_role']
export type BranchRef = { id: string; code: string; name: string }

export type Actor = {
  id: string
  username: string
  displayName: string
  role: Role
  locale: 'th' | 'en'
  branches: BranchRef[]
  /** the branch the staff app is working in (cookie sis_branch, validated) */
  branch: BranchRef | null
}

export type ActorState = { status: 'anonymous' } | { status: 'inactive' } | { status: 'ok'; actor: Actor }

export const BRANCH_COOKIE = 'sis_branch'

/**
 * The signed-in staff member, their role and the branches they may act in.
 * Uses getUser() (a round-trip to Auth) rather than the proxy's getClaims(), so
 * a session revoked elsewhere stops here instead of rendering until the JWT
 * expires. Cached per request.
 */
export const getActorState = cache(async (): Promise<ActorState> => {
  const supabase = await getSupabaseServer()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) {
    // Only "no/expired/revoked session" means signed out. An Auth outage must not
    // log every user out mid-shift — surface it as an error instead.
    const status = userError.status ?? 0
    if (userError.name === 'AuthSessionMissingError' || status === 401 || status === 403 || status === 400) {
      return { status: 'anonymous' }
    }
    throw new Error(`auth unavailable: ${userError.message}`)
  }
  if (!userData.user) return { status: 'anonymous' }
  // print-server accounts never act in the staff app (see sign-in.ts)
  if (userData.user.app_metadata?.print_branch) return { status: 'inactive' }

  // RLS returns exactly the branches this user may see (owner: all) — independent of the
  // profile row, so both run at once.
  const [{ data: profile, error: profileError }, { data: branches, error: branchError }] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, role, locale, active').eq('id', userData.user.id).maybeSingle(),
    supabase.from('branches').select('id, code, name').eq('active', true).order('sort').order('name').range(0, 199),
  ])
  if (profileError) throw new Error(`profile load failed: ${profileError.message}`)
  if (!profile || !profile.active) return { status: 'inactive' }
  if (branchError) throw new Error(`branches load failed: ${branchError.message}`)

  const store = await cookies()
  const wanted = store.get(BRANCH_COOKIE)?.value
  const list = branches ?? []
  const branch = list.find((b) => b.id === wanted) ?? list[0] ?? null

  return {
    status: 'ok',
    actor: {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name || profile.username,
      role: profile.role,
      locale: profile.locale === 'en' ? 'en' : 'th',
      branches: list,
      branch,
    },
  }
})

export function landingFor(role: Role): string {
  return role === 'owner' ? '/overview' : '/tonight'
}

export function isBarOrOwner(role: Role): boolean {
  return role === 'bar' || role === 'owner'
}
