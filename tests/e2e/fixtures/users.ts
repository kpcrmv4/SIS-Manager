import { randomBytes } from 'node:crypto'
import type { Db } from './db'
import { FIXTURE } from './env'

/**
 * The permanent E2E fixture: two branches the demo seed never uses and one
 * account per role. Idempotent — found by code/username, never recreated —
 * so runs cost no Auth sign-ups. Passwords are rotated each run (admin API,
 * not the sign-in rate limit) and live only in tests/e2e/.auth (gitignored).
 */
const L = FIXTURE === 'T' ? '' : FIXTURE.toLowerCase()
const N = FIXTURE === 'T' ? '' : FIXTURE

/** Branch codes / display names of this run's fixture set (default ZTA "E2E-A", ZTB "E2E-B"). */
export const E2E_BRANCHES = [
  { key: 'branchA', code: `Z${FIXTURE}A`, name: `E2E${N}-A` },
  { key: 'branchB', code: `Z${FIXTURE}B`, name: `E2E${N}-B` },
] as const
export const BRANCH_A_NAME = E2E_BRANCHES[0].name
export const BRANCH_B_NAME = E2E_BRANCHES[1].name
export const BRANCH_A_CODE = E2E_BRANCHES[0].code
export const BRANCH_B_CODE = E2E_BRANCHES[1].code

export type FixtureRole = 'staff' | 'bar' | 'owner' | 'staffB' | 'multi' | 'inactive'

export const E2E_USERS: Record<FixtureRole, { username: string; role: 'staff' | 'bar' | 'owner'; branches: ('branchA' | 'branchB')[]; active: boolean }> = {
  staff: { username: `e2e${L}.staff`, role: 'staff', branches: ['branchA'], active: true },
  bar: { username: `e2e${L}.bar`, role: 'bar', branches: ['branchA'], active: true },
  owner: { username: `e2e${L}.owner`, role: 'owner', branches: [], active: true },
  staffB: { username: `e2e${L}.staffb`, role: 'staff', branches: ['branchB'], active: true },
  multi: { username: `e2e${L}.multi`, role: 'staff', branches: ['branchA', 'branchB'], active: true },
  inactive: { username: `e2e${L}.inactive`, role: 'staff', branches: ['branchA'], active: false },
}

export const SIGNED_IN_ROLES: FixtureRole[] = ['staff', 'bar', 'owner', 'staffB', 'multi']

const email = (u: string) => `${u}@staff.sis.local`

/**
 * After a run the fixture accounts are switched off (the owner one sees every
 * real branch), and the fixture branches hidden. Setup switches them back on.
 */
export async function parkFixture(db: Db, users: Record<string, string>) {
  const ids = Object.values(users)
  if (ids.length) {
    const { error } = await db.from('profiles').update({ active: false }).in('id', ids)
    if (error) throw new Error(`park profiles: ${error.message}`)
  }
  const { error } = await db.from('branches').update({ active: false }).in('code', E2E_BRANCHES.map((b) => b.code))
  if (error) throw new Error(`park branches: ${error.message}`)
}

async function findUserId(db: Db, mail: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const hit = data.users.find((u) => u.email === mail)
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
  return null
}

export async function ensureFixture(db: Db) {
  const branchIds: Record<string, string> = {}
  for (const b of E2E_BRANCHES) {
    // never adopt a real branch that happens to use the fixture code
    const { data: existing, error: findError } = await db.from('branches').select('id, name').eq('code', b.code).maybeSingle()
    if (findError) throw new Error(`branch ${b.code}: ${findError.message}`)
    if (existing && existing.name !== b.name && !existing.name.startsWith('E2E')) {
      throw new Error(`branch code ${b.code} belongs to "${existing.name}", not the E2E fixture — refusing to touch it`)
    }
    const { data, error } = await db.from('branches').upsert({ code: b.code, name: b.name, sort: 900, active: true }, { onConflict: 'code' }).select('id').single()
    if (error) throw new Error(`branch ${b.code}: ${error.message}`)
    branchIds[b.key] = data.id
  }

  const users: Record<string, string> = {}
  const creds: Record<string, { username: string; email: string; password: string }> = {}
  for (const [role, spec] of Object.entries(E2E_USERS) as [FixtureRole, (typeof E2E_USERS)[FixtureRole]][]) {
    const mail = email(spec.username)
    const password = `E2e-${randomBytes(12).toString('base64url')}`
    let id = await findUserId(db, mail)
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email: mail,
        password,
        email_confirm: true,
        app_metadata: { username: spec.username, display_name: `E2E ${role}` },
      })
      if (error) throw new Error(`createUser ${mail}: ${error.message}`)
      id = data.user.id
    } else {
      const { error } = await db.auth.admin.updateUserById(id, { password })
      if (error) throw new Error(`updateUser ${mail}: ${error.message}`)
    }
    const { error: pErr } = await db
      .from('profiles')
      .update({ role: spec.role, active: spec.active, username: spec.username, display_name: `E2E ${role}`, locale: 'th' })
      .eq('id', id)
    if (pErr) throw new Error(`profile ${mail}: ${pErr.message}`)
    const { error: dErr } = await db.from('user_branches').delete().eq('user_id', id)
    if (dErr) throw new Error(`user_branches ${mail}: ${dErr.message}`)
    if (spec.branches.length) {
      const { error: iErr } = await db.from('user_branches').insert(spec.branches.map((k) => ({ user_id: id!, branch_id: branchIds[k] })))
      if (iErr) throw new Error(`user_branches ${mail}: ${iErr.message}`)
    }
    users[role] = id
    creds[role] = { username: spec.username, email: mail, password }
  }
  return { branchA: branchIds.branchA, branchB: branchIds.branchB, users, creds }
}
