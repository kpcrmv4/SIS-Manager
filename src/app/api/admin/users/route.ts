import { NextResponse, type NextRequest } from 'next/server'
import { getActorState } from '@/lib/auth/actor'
import { USERNAME_RE, usernameEmail } from '@/lib/auth/identifier'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

type Role = 'staff' | 'bar' | 'owner'
const ROLES: Role[] = ['staff', 'bar', 'owner']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body =
  | { action: 'create'; username: string; displayName: string; role: Role; branchIds: string[]; password: string }
  | { action: 'update'; userId: string; displayName?: string; role?: Role; active?: boolean; branchIds?: string[] }
  | { action: 'reset_password'; userId: string; password: string }

/**
 * Owner-only user management (P2-B3 UI). Staff accounts are created by the owner with the
 * service role — there is no sign-up. Order: who (401/403) before what (400/422).
 */
export async function POST(req: NextRequest) {
  const state = await getActorState()
  if (state.status !== 'ok') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (state.actor.role !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const me = state.actor

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body || typeof body !== 'object' || !('action' in body)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const admin = getSupabaseAdmin()

  const validBranches = async (ids: unknown): Promise<string[] | null> => {
    if (!Array.isArray(ids) || ids.length > 50 || !ids.every((i) => typeof i === 'string' && UUID.test(i))) return null
    if (!ids.length) return []
    const { data, error } = await admin.from('branches').select('id').in('id', ids)
    if (error || (data ?? []).length !== ids.length) return null
    return ids as string[]
  }
  // print-server accounts are provisioned by /api/print-server/setup only — never edited,
  // activated or given a password here (their password is in the shop PC's config.json)
  const isPrintAccount = async (userId: string): Promise<boolean | null> => {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error) return error.status === 404 ? false : null
    return Boolean(data.user?.app_metadata?.print_branch)
  }
  const setBranches = async (userId: string, ids: string[]) => {
    const { error: delError } = await admin.from('user_branches').delete().eq('user_id', userId)
    if (delError) return delError
    if (!ids.length) return null
    const { error } = await admin.from('user_branches').insert(ids.map((b) => ({ user_id: userId, branch_id: b })))
    return error
  }

  if (body.action === 'create') {
    const username = String(body.username ?? '').trim().toLowerCase()
    const displayName = String(body.displayName ?? '').trim().slice(0, 80)
    if (!USERNAME_RE.test(username) || !displayName || !ROLES.includes(body.role)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
      return NextResponse.json({ error: 'password_too_short' }, { status: 422 })
    }
    const branches = await validBranches(body.branchIds)
    if (!branches) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
    if (taken) return NextResponse.json({ error: 'username_taken' }, { status: 409 })

    const { data, error } = await admin.auth.admin.createUser({
      email: usernameEmail(username),
      password: body.password,
      email_confirm: true,
      app_metadata: { username, display_name: displayName },
    })
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message?.includes('already') ? 'username_taken' : 'unavailable' }, { status: error?.message?.includes('already') ? 409 : 503 })
    }
    const id = data.user.id
    const { error: pErr } = await admin.from('profiles').update({ role: body.role, display_name: displayName }).eq('id', id)
    const bErr = pErr ? null : await setBranches(id, branches)
    if (pErr || bErr) {
      // never leave a half-made account behind
      await admin.auth.admin.deleteUser(id)
      return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    }
    return NextResponse.json({ ok: true, id }, { status: 201 })
  }

  if ((body.action === 'update' || body.action === 'reset_password') && UUID.test(String(body.userId))) {
    const printAccount = await isPrintAccount(body.userId)
    if (printAccount === null) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    if (printAccount) return NextResponse.json({ error: 'print_account' }, { status: 422 })
  }

  if (body.action === 'update') {
    if (!UUID.test(String(body.userId))) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    const self = body.userId === me.id
    if (self && (body.role !== undefined || body.active === false)) return NextResponse.json({ error: 'cannot_change_self' }, { status: 422 })
    const patch: { display_name?: string; role?: Role; active?: boolean } = {}
    if (body.displayName !== undefined) {
      const n = String(body.displayName).trim().slice(0, 80)
      if (!n) return NextResponse.json({ error: 'invalid' }, { status: 400 })
      patch.display_name = n
    }
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
      patch.role = body.role
    }
    if (body.active !== undefined) patch.active = Boolean(body.active)
    if (Object.keys(patch).length) {
      const { data, error } = await admin.from('profiles').update(patch).eq('id', body.userId).select('id').maybeSingle()
      if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
      if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (body.branchIds !== undefined) {
      const branches = await validBranches(body.branchIds)
      if (!branches) return NextResponse.json({ error: 'invalid' }, { status: 400 })
      const err = await setBranches(body.userId, branches)
      if (err) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    }
    // a deactivated user keeps a JWT until it expires, but the staff layout sends
    // inactive profiles to logout and every RLS helper returns nothing for them
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'reset_password') {
    if (!UUID.test(String(body.userId))) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
      return NextResponse.json({ error: 'password_too_short' }, { status: 422 })
    }
    const { error } = await admin.auth.admin.updateUserById(body.userId, { password: body.password })
    if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'invalid' }, { status: 400 })
}
