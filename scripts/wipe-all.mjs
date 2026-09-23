#!/usr/bin/env node
// Wipe EVERY branch, account and row of test/demo data — keeps only the demo accounts
// (demo.owner · demo.bar · demo.staff) so `npm run demo:reset` can re-seed straight after.
// Owner request 2026-09-24 (R-029). Not for a project with real data: it refuses when any
// branch is not a demo branch (receipt_settings.demo) or an E2E fixture (Z??).
//
//   node scripts/wipe-all.mjs          → dry run: prints what would go
//   node scripts/wipe-all.mjs --yes    → deletes
import { createClient } from '@supabase/supabase-js'
import { loadEnv, mgmt, projectRef } from './lib/env.mjs'

const env = loadEnv()
projectRef(env)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const KEEP = new Set(['demo.owner@staff.sis.local', 'demo.bar@staff.sis.local', 'demo.staff@staff.sis.local'])
const FIXTURE_CODE = /^Z[A-Z]{2}$/
const YES = process.argv.includes('--yes')

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

async function storagePaths(bucket, prefix = '') {
  const out = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset })
    if (error) throw new Error(`storage list ${bucket}/${prefix}: ${error.message}`)
    for (const o of data) {
      const path = prefix ? `${prefix}/${o.name}` : o.name
      if (o.id) out.push(path)
      else out.push(...(await storagePaths(bucket, path))) // folder
    }
    if (data.length < 100) break
  }
  return out
}

async function main() {
  const branches = must('branches', await admin.from('branches').select('code, name, receipt_settings').range(0, 999))
  const real = branches.filter((b) => b.receipt_settings?.demo !== true && !FIXTURE_CODE.test(b.code))
  if (real.length) throw new Error(`branch(es) ${real.map((b) => b.code).join(', ')} are neither demo nor E2E fixtures — refusing`)
  const users = (await allUsers()).filter((u) => !KEEP.has(u.email))
  const buckets = must('buckets', await admin.storage.listBuckets())
  const files = {}
  for (const b of buckets) files[b.id] = await storagePaths(b.id)

  console.log(`branches: ${branches.map((b) => b.code).join(' ') || '-'}`)
  console.log(`accounts to delete: ${users.length} (keeping ${[...KEEP].map((e) => e.split('@')[0]).join(', ')})`)
  for (const [b, list] of Object.entries(files)) console.log(`storage ${b}: ${list.length} file(s)`)
  if (!YES) {
    console.log('dry run — pass --yes to delete')
    return
  }

  for (const t of ['line_outbox', 'notifications', 'print_jobs', 'print_stations', 'push_subscriptions', 'line_link_failures', 'deposits', 'bookings']) {
    must(t, await admin.from(t).delete().not('id', 'is', null))
  }
  must('branches', await admin.from('branches').delete().not('id', 'is', null)) // cascades settings, zones, tables, items, secrets, user_branches
  must('customers', await admin.from('customers').delete().not('id', 'is', null))
  must('liquor_items', await admin.from('liquor_items').delete().not('id', 'is', null))
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) throw new Error(`delete user ${u.email}: ${error.message}`)
  }
  for (const [b, list] of Object.entries(files)) {
    for (let i = 0; i < list.length; i += 100) {
      const { error } = await admin.storage.from(b).remove(list.slice(i, i + 100))
      if (error) throw new Error(`storage remove ${b}: ${error.message}`)
    }
  }
  await mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query: 'delete from private.login_attempts where true' }) })
  console.log('wipe-all: done')
}

main().catch((e) => {
  console.error(`wipe-all: failed — ${e.message}`)
  process.exitCode = 1
})
