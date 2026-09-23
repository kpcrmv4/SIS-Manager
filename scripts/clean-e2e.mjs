#!/usr/bin/env node
// Removes what the E2E suite leaves in the shared project: the fixture branches (code Z?? AND
// name E2E…) with every row that hangs off them, the fixture and fixture-print accounts, the
// customers the specs made (name E2E…, nothing outside the fixture branches) and the fixture
// photos. Never touches a real or demo branch, the demo accounts, or any branch's LINE setup —
// unlike scripts/wipe-all.mjs, which is a full reset (R-029, L-010).
//
//   node scripts/clean-e2e.mjs          → dry run: prints what would go
//   node scripts/clean-e2e.mjs --yes    → deletes
import { createClient } from '@supabase/supabase-js'
import { loadEnv, projectRef } from './lib/env.mjs'

const env = loadEnv()
projectRef(env)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const YES = process.argv.includes('--yes')
const FIXTURE_CODE = /^Z[A-Z]{2}$/
// e2e.staff / e2ea.owner … and the print accounts of fixture branches (printer-zta)
const FIXTURE_USER = /^(e2e[a-z]?\.[a-z]+@staff|printer-z[a-z]{2}@print)\.sis\.local$/

const must = (label, { data, error }) => {
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function allUsers() {
  const out = []
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    out.push(...data.users)
    if (data.users.length < 200) break
  }
  return out
}

async function storagePaths(bucket, prefix) {
  const out = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset })
    if (error) throw new Error(`storage list ${bucket}/${prefix}: ${error.message}`)
    for (const o of data) {
      const path = `${prefix}/${o.name}`
      if (o.id) out.push(path)
      else out.push(...(await storagePaths(bucket, path)))
    }
    if (data.length < 100) break
  }
  return out
}

async function main() {
  const branches = must('branches', await admin.from('branches').select('id, code, name').range(0, 999))
  const fixtures = branches.filter((b) => FIXTURE_CODE.test(b.code))
  const foreign = fixtures.filter((b) => !b.name.startsWith('E2E'))
  if (foreign.length) throw new Error(`branch(es) ${foreign.map((b) => b.code).join(', ')} use a fixture code but are not E2E fixtures — refusing`)
  const ids = fixtures.map((b) => b.id)
  const others = branches.filter((b) => !ids.includes(b.id)).map((b) => b.id)

  const users = (await allUsers()).filter((u) => FIXTURE_USER.test(u.email ?? ''))

  // spec-made customers: an E2E-tagged name and no deposit / booking at a non-fixture branch
  const tagged = must('customers', await admin.from('customers').select('id').like('display_name', 'E2E%').range(0, 999))
  const keep = new Set()
  if (tagged.length && others.length) {
    const cid = tagged.map((c) => c.id)
    for (const t of ['deposits', 'bookings']) {
      const rows = must(t, await admin.from(t).select('customer_id').in('customer_id', cid).in('branch_id', others).range(0, 999))
      for (const r of rows) keep.add(r.customer_id)
    }
  }
  const customers = tagged.filter((c) => !keep.has(c.id)).map((c) => c.id)

  const files = []
  for (const id of ids) files.push(...(await storagePaths('deposit-photos', id)))

  console.log(`fixture branches: ${fixtures.map((b) => b.code).join(' ') || '-'}`)
  console.log(`accounts: ${users.length} · customers: ${customers.length} · photos: ${files.length}`)
  if (!YES) {
    console.log('dry run — pass --yes to delete')
    return
  }

  if (ids.length) {
    for (const t of ['line_outbox', 'notifications', 'print_jobs', 'print_stations', 'line_link_failures', 'deposits', 'bookings']) {
      must(t, await admin.from(t).delete().in('branch_id', ids))
    }
    must('branches', await admin.from('branches').delete().in('id', ids)) // cascades settings, zones, tables, items, secrets, user_branches
  }
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) throw new Error(`delete user ${u.email}: ${error.message}`)
  }
  if (customers.length) must('customers', await admin.from('customers').delete().in('id', customers))
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await admin.storage.from('deposit-photos').remove(files.slice(i, i + 100))
    if (error) throw new Error(`storage remove: ${error.message}`)
  }
  console.log('clean-e2e: done')
}

main().catch((e) => {
  console.error(`clean-e2e: failed — ${e.message}`)
  process.exitCode = 1
})
