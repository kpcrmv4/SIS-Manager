import { expect, test } from '@playwright/test'
import { adminDb, anonDb, dbAs, fixtureIds } from './fixtures/db'

/**
 * DB-level RLS rows for the core tables. Every "invisible" assertion names a
 * rival row that exists in branch B while the line runs.
 */
const PUBLIC_TABLES = ['branches', 'branch_line_secrets', 'profiles', 'user_branches', 'liquor_items', 'customers'] as const

test.describe.configure({ mode: 'serial' })

test('P1-CORE-01 metadata cannot choose a role: new user is staff', async () => {
  const admin = adminDb()
  const email = `p1core01.${Date.now()}@staff.sis.local`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Tmp-${Date.now()}-x`,
    email_confirm: true,
    user_metadata: { role: 'owner', username: 'hacker' },
    app_metadata: { username: `p1core01${Date.now() % 100000}` },
  })
  expect(error).toBeNull()
  try {
    const { data: p } = await admin.from('profiles').select('role, username').eq('id', data.user!.id).single()
    expect(p?.role).toBe('staff')
    expect(p?.username).not.toBe('hacker')
  } finally {
    await admin.auth.admin.deleteUser(data.user!.id)
  }
})

test('P1-CORE-02 staff cannot raise their own role', async () => {
  const { users } = fixtureIds()
  const { error } = await dbAs('staff').from('profiles').update({ role: 'owner' }).eq('id', users.staff).select('id')
  expect(error?.message).toMatch(/OWNER_ONLY/)
  const { data } = await adminDb().from('profiles').select('role').eq('id', users.staff).single()
  expect(data?.role).toBe('staff')
})

test('P1-CORE-03 staff may change own display_name and locale', async () => {
  const { users } = fixtureIds()
  const { data, error } = await dbAs('staff').from('profiles').update({ display_name: 'E2E staff', locale: 'th' }).eq('id', users.staff).select('id')
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
})

test('P1-CORE-04 owner can deactivate and reactivate another user', async () => {
  const { users } = fixtureIds()
  const owner = dbAs('owner')
  const off = await owner.from('profiles').update({ active: false }).eq('id', users.staffB).select('active').single()
  expect(off.error).toBeNull()
  expect(off.data?.active).toBe(false)
  const on = await owner.from('profiles').update({ active: true }).eq('id', users.staffB).select('active').single()
  expect(on.data?.active).toBe(true)
})

test('P1-CORE-05 nobody signed in can read branch_line_secrets', async () => {
  for (const role of ['owner', 'staff'] as const) {
    const { data, error } = await dbAs(role).from('branch_line_secrets').select('branch_id')
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  }
})

test('P1-CORE-06 staff sees only their own branch', async () => {
  const { branchA, branchB } = fixtureIds()
  const { data, error } = await dbAs('staff').from('branches').select('id').order('id').range(0, 99)
  expect(error).toBeNull()
  const ids = (data ?? []).map((b) => b.id)
  expect(ids).toContain(branchA)
  expect(ids).not.toContain(branchB)
  expect(ids).toHaveLength(1)
})

test('P1-CORE-07 owner sees every branch', async () => {
  const { branchA, branchB } = fixtureIds()
  const { data } = await dbAs('owner').from('branches').select('id').order('id').range(0, 999)
  const ids = (data ?? []).map((b) => b.id)
  expect(ids).toEqual(expect.arrayContaining([branchA, branchB]))
  const { count } = await adminDb().from('branches').select('id', { count: 'exact', head: true })
  expect(ids).toHaveLength(count!)
})

test('P1-CORE-08 bar cannot create a branch', async () => {
  const { data, error } = await dbAs('bar').from('branches').insert({ code: 'ZZX', name: 'nope' }).select('id')
  expect(data).toBeNull()
  expect(error?.code).toBe('42501')
  const { count } = await adminDb().from('branches').select('id', { count: 'exact', head: true }).eq('code', 'ZZX')
  expect(count).toBe(0)
})

test('P1-CORE-09 liquor items: global + own branch only', async () => {
  const { branchA, branchB } = fixtureIds()
  const admin = adminDb()
  const tag = `p1core09-${Date.now()}`
  const { data: rows, error } = await admin
    .from('liquor_items')
    .insert([
      { name: `${tag}-global`, branch_id: null },
      { name: `${tag}-A`, branch_id: branchA },
      { name: `${tag}-B`, branch_id: branchB },
    ])
    .select('id')
  expect(error).toBeNull()
  try {
    const { data } = await dbAs('staff').from('liquor_items').select('name').like('name', `${tag}%`).order('name').range(0, 9)
    expect((data ?? []).map((r) => r.name)).toEqual([`${tag}-A`, `${tag}-global`])
  } finally {
    await admin.from('liquor_items').delete().in('id', (rows ?? []).map((r) => r.id))
  }
})

test('P1-CORE-10 anon has no grant on any public table', async () => {
  const anon = anonDb()
  for (const t of PUBLIC_TABLES) {
    const { data, error } = await anon.from(t).select('*').limit(1)
    expect(data, t).toBeNull()
    expect(error?.code, t).toBe('42501')
  }
})

test('P1-CORE-11 a deactivated user sees no branches', async () => {
  const { users } = fixtureIds()
  const admin = adminDb()
  await admin.from('profiles').update({ active: false }).eq('id', users.staffB)
  try {
    const { data, error } = await dbAs('staffB').from('branches').select('id').range(0, 9)
    expect(error).toBeNull()
    expect(data).toEqual([])
  } finally {
    await admin.from('profiles').update({ active: true }).eq('id', users.staffB)
  }
})

test('P1-CORE-12 profiles: self + colleagues of the same branch, not other branches', async () => {
  const { users } = fixtureIds()
  const { data } = await dbAs('staff').from('profiles').select('id').range(0, 99)
  const ids = (data ?? []).map((p) => p.id)
  expect(ids).toEqual(expect.arrayContaining([users.staff, users.bar, users.multi]))
  expect(ids).not.toContain(users.staffB)
  expect(ids).not.toContain(users.owner)
})
