#!/usr/bin/env node
// Demo reset + seed (P5-01, CLAUDE §9, R-029). Wipes and re-seeds ONLY the demo branch
// SRC (SIS Music Bar ศรีราชา) and the three demo accounts (demo.owner · demo.bar · demo.staff).
// Every other branch — the E2E fixtures included — is never read for deletion.
//
//   npm run demo:reset
//
// Passwords come from SEED_OWNER_PASSWORD / SEED_BAR_PASSWORD / SEED_STAFF_PASSWORD in
// .env.local; a missing key stops the run before anything is written (no default password).
// Seeding goes through the real RPCs signed in as the demo accounts, so history, events and
// the LINE outbox look like real use; aged states are adjusted with scoped updates after.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, projectRef, root } from './lib/env.mjs'

// DEMO_RESET_ENV_FILE: read ONLY that file (the spec proves the missing-key refusal with a
// throwaway file of dummy values — no secret is ever copied into it)
function envFrom(file) {
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}
const env = process.env.DEMO_RESET_ENV_FILE ? envFrom(process.env.DEMO_RESET_ENV_FILE) : loadEnv()
const REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SEED_OWNER_PASSWORD', 'SEED_BAR_PASSWORD', 'SEED_STAFF_PASSWORD']
const missing = REQUIRED.filter((k) => !env[k] || (k.startsWith('SEED_') && env[k].length < 8))
if (missing.length) {
  console.error(`demo-reset: missing or too short (min 8) in .env.local: ${missing.join(', ')} — nothing was changed`)
  process.exit(1)
}
projectRef(env) // refuses a URL that does not match the pinned project

const URL = env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const STAFF_DOMAIN = 'staff.sis.local'

// Demo-only codes (never a real branch's code) + a marker in receipt_settings: the reset
// only ever adopts a branch it made itself (security review P3/P4 — a real "RMI" must be safe).
// The owner chose one demo branch under the shop's real name (R-029); the marker still keeps
// the reset away from any branch it did not make.
const DEMO_MARK = { demo: true, header: 'SIS Music Bar ศรีราชา', footer: 'ข้อมูลตัวอย่าง', copies: 1 }
const BRANCHES = [{ code: 'SRC', name: 'SIS Music Bar ศรีราชา', sort: 1, phone: '038-000-000' }]
const DEMO_CODES = BRANCHES.map((b) => b.code)
const FIXTURE_CODE = /^Z[A-Z]{2}$/ // E2E fixture branches (tests/e2e/fixtures/users.ts)
const USERS = [
  { key: 'owner', username: 'demo.owner', display: 'คุณเจ้าของ (เดโม)', role: 'owner', branches: ['SRC'], pw: env.SEED_OWNER_PASSWORD },
  { key: 'bar', username: 'demo.bar', display: 'bar ต้น (เดโม)', role: 'bar', branches: ['SRC'], pw: env.SEED_BAR_PASSWORD },
  { key: 'staff', username: 'demo.staff', display: 'staff มิ้นท์ (เดโม)', role: 'staff', branches: ['SRC'], pw: env.SEED_STAFF_PASSWORD },
]
// LINE user ids are U + 32 hex — demo customers use a recognisable hex prefix
const DEMO_LINE_PREFIX = 'Udeadbeef'
const ITEMS = [
  ['Johnnie Walker Black Label', 'whisky'],
  ['Chivas Regal 12 ปี', 'whisky'],
  ['Hennessy VSOP', 'brandy'],
  ['Regency', 'brandy'],
  ['Absolut Vodka', 'vodka'],
  ['Jameson', 'whisky'],
]

const must = (label, { data, error }) => {
  if (error) throw new Error(`${label}: ${error.code ?? ''} ${error.message}`)
  return data
}
const bkkDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
// business night rolls over at 06:00 Bangkok (R-006)
const businessNight = () => bkkDate(new Date(Date.now() - 6 * 3600 * 1000))
const daysFromNow = (n) => new Date(Date.now() + n * 86400 * 1000).toISOString()

// ── 0. guards: never touch a branch this script did not make ───────────────
async function guard() {
  const all = must('branches', await admin.from('branches').select('code, active, receipt_settings').range(0, 999))
  const foreign = all.filter((b) => DEMO_CODES.includes(b.code) && b.receipt_settings?.demo !== true)
  if (foreign.length) {
    throw new Error(`branch code(s) ${foreign.map((b) => b.code).join(', ')} exist but were not made by demo-reset — refusing to touch them`)
  }
  // a branch an older demo-reset made (marked) is not real data
  const real = all.filter((b) => b.active && b.receipt_settings?.demo !== true && !FIXTURE_CODE.test(b.code))
  if (real.length && env.DEMO_RESET_ALLOW_WITH_REAL_BRANCHES !== '1') {
    throw new Error(
      `this project has real branches (${real.map((b) => b.code).join(', ')}) — demo data does not belong next to them. ` +
        'Set DEMO_RESET_ALLOW_WITH_REAL_BRANCHES=1 in .env.local only if you are sure',
    )
  }
}

// ── 1. branches ─────────────────────────────────────────────────────────
async function upsertBranches() {
  // L-010: the owner may have set the receipt (header, LINE QR) on the demo branch since — keep
  // what is there and only make sure the demo marker stays
  const existing = must('branches', await admin.from('branches').select('code, receipt_settings').in('code', DEMO_CODES))
  const receipt = (code) => {
    const now = existing.find((r) => r.code === code)?.receipt_settings
    return now && typeof now === 'object' ? { ...DEMO_MARK, ...now, demo: true } : DEMO_MARK
  }
  const rows = must(
    'branches',
    await admin
      .from('branches')
      .upsert(
        BRANCHES.map((b) => ({ ...b, active: true, deposit_days: 30, expiry_notice_days: 7, withdrawal_blocked_days: ['Fri', 'Sat'], opens_at: '19:00', closes_at: '02:00', receipt_settings: receipt(b.code) })),
        { onConflict: 'code' },
      )
      .select('id, code'),
  )
  return Object.fromEntries(rows.map((r) => [r.code, r.id]))
}

// ── 2. accounts ─────────────────────────────────────────────────────────
async function upsertUsers(branchIds) {
  const ids = {}
  for (const u of USERS) {
    const found = must('profile lookup', await admin.from('profiles').select('id').eq('username', u.username).maybeSingle())
    let id = found?.id
    if (!id) {
      const created = await admin.auth.admin.createUser({
        email: `${u.username}@${STAFF_DOMAIN}`,
        password: u.pw,
        email_confirm: true,
        app_metadata: { username: u.username, display_name: u.display },
      })
      if (created.error) throw new Error(`create ${u.username}: ${created.error.message}`)
      id = created.data.user.id
    } else {
      const upd = await admin.auth.admin.updateUserById(id, { password: u.pw })
      if (upd.error) throw new Error(`password ${u.username}: ${upd.error.message}`)
    }
    must('profile', await admin.from('profiles').update({ role: u.role, display_name: u.display, active: true, locale: 'th' }).eq('id', id))
    must('user_branches clear', await admin.from('user_branches').delete().eq('user_id', id))
    must('user_branches', await admin.from('user_branches').insert(u.branches.map((c) => ({ user_id: id, branch_id: branchIds[c] }))))
    ids[u.key] = id
  }
  return ids
}

// ── 3. wipe (demo branches + demo accounts only) ──────────────────────────
async function wipe(branchIds, userIds) {
  const b = Object.values(branchIds)
  must('outbox', await admin.from('line_outbox').delete().in('branch_id', b))
  must('notifications', await admin.from('notifications').delete().or(`branch_id.in.(${b.join(',')}),user_id.in.(${Object.values(userIds).join(',')})`))
  must('print_jobs', await admin.from('print_jobs').delete().in('branch_id', b))
  must('deposits', await admin.from('deposits').delete().in('branch_id', b))
  must('bookings', await admin.from('bookings').delete().in('branch_id', b))
  must('blackouts', await admin.from('booking_blackouts').delete().in('branch_id', b))
  must('tables', await admin.from('tables').delete().in('branch_id', b))
  must('zones', await admin.from('table_zones').delete().in('branch_id', b))
  must('items', await admin.from('liquor_items').delete().in('branch_id', b))
  must('customer VIPs', await admin.from('customer_vips').delete().in('branch_id', b))
  must('customers', await admin.from('customers').delete().like('line_user_id', `${DEMO_LINE_PREFIX}%`))
}

// ── 4. floor plan, items, customers, photos ───────────────────────────────
async function seedFloor(branchId) {
  const zones = must(
    'zones',
    await admin
      .from('table_zones')
      .insert([
        { branch_id: branchId, name: 'โซนหน้าเวที', customer_bookable: true, sort: 1 },
        { branch_id: branchId, name: 'โซนบาร์', customer_bookable: true, sort: 2 },
        { branch_id: branchId, name: 'ห้อง VIP', customer_bookable: false, sort: 3 },
      ])
      .select('id, name'),
  )
  const z = Object.fromEntries(zones.map((r) => [r.name, r.id]))
  const tables = [
    ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((label, i) => ({ zone_id: z['โซนหน้าเวที'], label, shape: 'square', seats_min: 2, seats_max: 6, sort: i })),
    ...['B1', 'B2', 'B3', 'B4'].map((label, i) => ({ zone_id: z['โซนบาร์'], label, shape: 'round', seats_min: 2, seats_max: 4, sort: 10 + i })),
    { zone_id: z['ห้อง VIP'], label: 'V1', shape: 'room', seats_min: 6, seats_max: 12, sort: 20 },
  ]
  const rows = must('tables', await admin.from('tables').insert(tables.map((t) => ({ ...t, branch_id: branchId }))).select('id, label'))
  return Object.fromEntries(rows.map((r) => [r.label, r.id]))
}

async function ensureItems() {
  const existing = must('items', await admin.from('liquor_items').select('name').is('branch_id', null).range(0, 999))
  const have = new Set(existing.map((r) => r.name))
  const add = ITEMS.filter(([name]) => !have.has(name)).map(([name, category], i) => ({ branch_id: null, name, category, active: true, sort: 100 + i }))
  if (add.length) must('items insert', await admin.from('liquor_items').insert(add))
}

async function seedCustomers() {
  const rows = must(
    'customers',
    await admin
      .from('customers')
      .insert([
        { line_user_id: `${DEMO_LINE_PREFIX}000000000000000000000001`, display_name: 'คุณธนพล (LINE เดโม)', phone: '081-234-5678', locale: 'th' },
        { line_user_id: `${DEMO_LINE_PREFIX}000000000000000000000002`, display_name: 'Mr. James (LINE demo)', phone: '089-777-1203', locale: 'en' },
      ])
      .select('id, locale'),
  )
  return { th: rows.find((r) => r.locale === 'th').id, en: rows.find((r) => r.locale === 'en').id }
}

async function demoPhoto(branchId) {
  const month = bkkDate().slice(0, 7)
  const path = `${branchId}/${month}/demo-bottle.png`
  const bytes = readFileSync(join(root, 'public', 'android-chrome-512x512.png'))
  const { error } = await admin.storage.from('deposit-photos').upload(path, bytes, { contentType: 'image/png', upsert: true })
  if (error) throw new Error(`photo upload: ${error.message}`)
  return path
}

// ── 5. signed-in demo clients ────────────────────────────────────────────
async function signIn(user) {
  const c = createClient(URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email: `${user.username}@${STAFF_DOMAIN}`, password: user.pw })
  if (error) throw new Error(`sign in ${user.username}: ${error.message}`)
  return c
}

const rpc = async (client, fn, args) => must(fn, await client.rpc(fn, args))

// ── 6. deposits in every display state ───────────────────────────────────
async function seedDeposits(c, branchIds, photos, customers) {
  const RMI = branchIds.SRC
  const create = async (who, branch, name, phone, item, qty, table, extra = {}) =>
    rpc(who, 'create_deposit', { p_branch: branch, p_customer_name: name, p_customer_phone: phone, p_item_name: item, p_quantity: qty, p_table: table, p_photo_paths: [photos[branch]], ...extra })
  const confirm = (id, levels, branch = RMI, who = c.bar) => rpc(who, 'confirm_deposit', { p_deposit: id, p_levels: levels, p_photo_paths: [photos[branch]] })
  const bottles = async (id) => must('bottles', await admin.from('deposit_bottles').select('id').eq('deposit_id', id).neq('status', 'consumed').order('bottle_no'))

  // in store (two ordinary, one linked to a LINE customer)
  const d1 = await create(c.staff, RMI, 'คุณธนพล ศรีสุข', '081-234-5678', 'Johnnie Walker Black Label', 2, 'A3')
  await confirm(d1.id, [100, 60])
  const link = must('link row', await admin.from('deposits').select('link_token').eq('id', d1.id).single())
  await rpc(admin, 'link_deposit_customer', { p_branch: RMI, p_token: link.link_token, p_customer_id: customers.th })
  const d2 = await create(c.staff, RMI, 'คุณกิตติศักดิ์ เจริญผล', '089-777-1203', 'Jameson', 1, 'B2')
  await confirm(d2.id, [30])

  // near expiry (≤ 2 days) — bar may set the expiry; LINE notice marked sent
  const near = await create(c.bar, RMI, 'คุณสุภาวดี นิลวงศ์', '095-338-2019', 'Hennessy VSOP', 1, 'A1', { p_expires_at: daysFromNow(2) })
  await confirm(near.id, [40])
  must('near notice', await admin.from('deposits').update({ expiry_notice_sent_at: new Date().toISOString() }).eq('id', near.id))

  // a VIP customer (R-048): every bottle of theirs never expires, and neither will the next one
  const vip = await create(c.staff, RMI, 'คุณวรวุฒิ สายทอง', '062-510-8844', 'Chivas Regal 12 ปี', 3, 'V1')
  await confirm(vip.id, [100, 100, 100])
  await rpc(c.bar, 'set_customer_vip', { p_branch: RMI, p_key: 'p-0625108844', p_vip: true })

  // waiting for bar to confirm
  await create(c.staff, RMI, 'คุณภานุวัฒน์ ใจดี', '086-102-4477', 'Regency', 1, 'A5')

  // withdrawal requested by the LINE customer (take home)
  const wreq = await create(c.staff, RMI, 'คุณธนพล ศรีสุข', '081-234-5678', 'Absolut Vodka', 2, 'A2')
  await confirm(wreq.id, [100, 80])
  const wlink = must('link row', await admin.from('deposits').select('link_token').eq('id', wreq.id).single())
  await rpc(admin, 'link_deposit_customer', { p_branch: RMI, p_token: wlink.link_token, p_customer_id: customers.th })
  const wb = await bottles(wreq.id)
  await rpc(admin, 'request_withdrawal', { p_deposit: wreq.id, p_bottle_ids: [wb[0].id], p_type: 'take_home', p_customer_id: customers.th, p_branch: RMI })

  // fully withdrawn
  const done = await create(c.staff, RMI, 'คุณมานพ ทองดี', '087-555-0101', 'Jameson', 1, 'B1')
  await confirm(done.id, [50])
  const db = await bottles(done.id)
  const wd = await rpc(c.staff, 'request_withdrawal', { p_deposit: done.id, p_bottle_ids: [db[0].id], p_type: 'in_store', p_table: 'B1' })
  const wdIds = must('withdrawal ids', await admin.from('withdrawals').select('id').eq('deposit_id', done.id).eq('status', 'pending')).map((w) => w.id)
  void wd
  await rpc(c.bar, 'complete_withdrawals', { p_withdrawal_ids: wdIds })

  // expired, awaiting disposal — and one already disposed
  const exp = await create(c.staff, RMI, 'คุณเอกชัย รุ่งเรือง', '081-999-2233', 'Absolut Vodka', 1, 'A4')
  await confirm(exp.id, [20])
  const disp = await create(c.staff, RMI, 'คุณมานพ ทองดี', '087-555-0101', 'Johnnie Walker Black Label', 1, 'A6')
  await confirm(disp.id, [10])
  must('age', await admin.from('deposits').update({ status: 'expired', expires_at: daysFromNow(-14), collect_deadline_at: daysFromNow(-13), expired_notice_sent_at: daysFromNow(-13) }).in('id', [exp.id, disp.id]))
  await rpc(c.bar, 'dispose_deposits', { p_deposit_ids: [disp.id], p_reason: 'เลยกำหนดรับคืน', p_photo_paths: [photos[RMI]] })

  // bar rejected a received deposit → cancelled
  const rej = await create(c.staff, RMI, 'คุณนภา ใจงาม', '080-111-2222', 'Regency', 1, 'B3')
  await rpc(c.bar, 'reject_deposit', { p_deposit: rej.id, p_reason: 'ขวดไม่ตรงกับที่แจ้ง' })

  // deposit request from LINE (not yet received)
  await rpc(admin, 'customer_request_deposit', {
    p_branch: RMI, p_customer_id: customers.en, p_customer_name: 'Mr. James', p_customer_phone: '089-777-1203',
    p_item_name: 'Hennessy VSOP', p_quantity: 1, p_table: 'B4', p_terms_locale: 'en', p_terms_version: '2026-09',
  })

  // partly withdrawn: one of two bottles taken, the other still on the shelf
  const part = await create(c.staff, RMI, 'คุณปกรณ์ วงศ์ดี', '090-414-7788', 'Chivas Regal 12 ปี', 2, 'A2')
  await confirm(part.id, [100, 70])
  const pb = await bottles(part.id)
  await rpc(c.staff, 'request_withdrawal', { p_deposit: part.id, p_bottle_ids: [pb[1].id], p_type: 'in_store', p_table: 'A2' })
  const partIds = must('withdrawal ids', await admin.from('withdrawals').select('id').eq('deposit_id', part.id).eq('status', 'pending')).map((w) => w.id)
  await rpc(c.bar, 'complete_withdrawals', { p_withdrawal_ids: partIds })

  // a withdrawal the bar rejected (the deposit stays in store)
  const wrej = await create(c.staff, RMI, 'คุณอรวรรณ แสงทอง', '091-222-6060', 'Jameson', 1, 'B4')
  await confirm(wrej.id, [90])
  const rb = await bottles(wrej.id)
  await rpc(c.staff, 'request_withdrawal', { p_deposit: wrej.id, p_bottle_ids: [rb[0].id], p_type: 'in_store', p_table: 'B4' })
  const rejIds = must('withdrawal ids', await admin.from('withdrawals').select('id').eq('deposit_id', wrej.id).eq('status', 'pending')).map((w) => w.id)
  await rpc(c.bar, 'reject_withdrawal', { p_withdrawal_ids: rejIds, p_reason: 'ขวดไม่ตรงกับที่ฝาก' })

  // a staff-side withdrawal waiting for the bar (in store, tonight)
  const wst = await create(c.staff, RMI, 'คุณชยพล มีสุข', '083-640-1122', 'Johnnie Walker Black Label', 1, 'A4')
  await confirm(wst.id, [60])
  const sb = await bottles(wst.id)
  await rpc(c.staff, 'request_withdrawal', { p_deposit: wst.id, p_bottle_ids: [sb[0].id], p_type: 'in_store', p_table: 'A4' })

  // received by the owner (history shows a third person)
  const own = await create(c.owner, RMI, 'คุณศิริพร ใจเย็น', '084-909-3030', 'Hennessy VSOP', 2, 'V1')
  await confirm(own.id, [100, 100], RMI, c.owner)
}

// ── 7. bookings in every state + a closed weekday and a blackout ─────────────
async function seedBookings(c, branchIds, tables, customers) {
  const RMI = branchIds.SRC
  const night = businessNight()
  const open = { line_enabled: true, auto_confirm: false, advance_days: 30, cutoff_time: '23:59', slot_start: '19:00', slot_end: '23:00', slot_minutes: 30, max_bookings_per_night: null, party_min: 1, party_max: 20, no_show_minutes: 30, customer_cancel_hours: 2, closed_weekdays: [] }
  must('settings open', await admin.from('booking_settings').update(open).eq('branch_id', RMI))
  const staffBook = (n, slot, party, name, phone, table) =>
    rpc(c.staff, 'create_booking', { p_branch: RMI, p_night: n, p_slot: slot, p_party: party, p_name: name, p_phone: phone, p_table: table })
  const lineBook = (n, slot, party, name, customer) => rpc(admin, 'create_booking', { p_branch: RMI, p_night: n, p_slot: slot, p_party: party, p_name: name, p_customer_id: customer })

  const confirmed = await staffBook(night, '21:00', 4, 'คุณธนพล', '081-234-5678', tables.SRC.A3)
  void confirmed
  const arrived = await staffBook(night, '20:00', 6, 'คุณกิตติศักดิ์', '089-777-1203', tables.SRC.A1)
  await rpc(c.staff, 'check_in_booking', { p_branch: RMI, p_ref: arrived.code })
  const noShow = await staffBook(night, '19:00', 2, 'คุณวีระ', '082-333-4444', tables.SRC.B1)
  must('no-show', await admin.from('bookings').update({ status: 'no_show', no_show_at: new Date().toISOString() }).eq('id', noShow.id))
  await lineBook(night, '22:00', 5, 'Mr. James', customers.en) // pending, waiting for the bar
  const cancelled = await staffBook(night, '22:30', 3, 'คุณนภา', '080-111-2222', null)
  await rpc(c.staff, 'cancel_booking', { p_booking: cancelled.id, p_reason: 'ลูกค้าโทรยกเลิก' })
  const rejected = await lineBook(night, '23:00', 8, 'คุณธนพล', customers.th)
  await rpc(c.bar, 'reject_booking', { p_booking: rejected.id, p_reason: 'โต๊ะเต็มคืนนี้' })
  // upcoming nights
  await staffBook(addDays(night, 1), '20:30', 4, 'คุณสุภาวดี', '095-338-2019', tables.SRC.A2)
  await lineBook(addDays(night, 2), '21:30', 2, 'คุณธนพล', customers.th)

  // final rules: Monday closed, cutoff 18:00, a private-event blackout next week
  must('settings final', await admin.from('booking_settings').update({ ...open, cutoff_time: '18:00', advance_days: 14, max_bookings_per_night: 20, party_max: 12, closed_weekdays: [0] }).eq('branch_id', RMI))
  must('blackout', await admin.from('booking_blackouts').insert({ branch_id: RMI, night: addDays(night, 5), reason: 'ปิดจัดงานส่วนตัว', line_only: false }))
}

// ── run ─────────────────────────────────────────────────────────────────
async function main() {
  await guard()
  const branchIds = await upsertBranches()
  const userIds = await upsertUsers(branchIds)
  await wipe(branchIds, userIds)
  await ensureItems()
  const tables = {}
  for (const code of Object.keys(branchIds)) tables[code] = await seedFloor(branchIds[code])
  const customers = await seedCustomers()
  const photos = {}
  for (const id of Object.values(branchIds)) photos[id] = await demoPhoto(id)
  const c = {
    owner: await signIn(USERS[0]),
    bar: await signIn(USERS[1]),
    staff: await signIn(USERS[2]),
  }
  await seedDeposits(c, branchIds, photos, customers)
  await seedBookings(c, branchIds, tables, customers)
  for (const client of Object.values(c)) await client.auth.signOut()

  const count = async (table, col, ids) => {
    const { data, error } = await admin.from(table).select(col).in('branch_id', ids).range(0, 999)
    if (error) throw new Error(`${table} count: ${error.message}`)
    return data.reduce((m, r) => ((m[r[col]] = (m[r[col]] ?? 0) + 1), m), {})
  }
  const ids = Object.values(branchIds)
  console.log('demo-reset: ok · run id', randomUUID().slice(0, 8))
  console.log('  deposits', JSON.stringify(await count('deposits', 'status', ids)))
  console.log('  bookings', JSON.stringify(await count('bookings', 'status', ids)))
}

main().catch((e) => {
  console.error(`demo-reset: failed — ${e.message}`)
  // exitCode, not process.exit(): exiting with fetch sockets still open trips a libuv
  // assertion on Windows (0xC0000409) and the real status is lost
  process.exitCode = 1
})
