import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { adminDb, dbAs, fixtureIds, sql } from './fixtures/db'
import { RUN, cleanupRun, mustCreate } from './fixtures/deposits'
import { required } from './fixtures/env'

test.describe.configure({ mode: 'serial' })

const admin = () => adminDb()

test.afterAll(async () => {
  await cleanupRun()
  const { branchA, branchB } = fixtureIds()
  await admin().from('print_jobs').delete().in('branch_id', [branchA, branchB])
  await admin().from('line_outbox').delete().like('dedupe_key', `${RUN}%`)
})

test('P1-OUT-01 a dedupe key admits one outbox row', async () => {
  const { branchA } = fixtureIds()
  const row = { branch_id: branchA, target_kind: 'user', target: `U${'1'.repeat(32)}`, kind: 'test', dedupe_key: `${RUN}:dedupe` }
  expect((await admin().from('line_outbox').insert(row)).error).toBeNull()
  expect((await admin().from('line_outbox').insert(row)).error?.code).toBe('23505')
  const { count } = await admin().from('line_outbox').select('id', { count: 'exact', head: true }).eq('dedupe_key', row.dedupe_key)
  expect(count).toBe(1)
})

test('P1-OUT-02 no signed-in role can read the outbox', async () => {
  for (const role of ['owner', 'bar'] as const) {
    const { data, error } = await dbAs(role).from('line_outbox').select('id').limit(1)
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  }
})

test('P1-OUT-09 claim → sending; failed backs off; sent is final; not callable by staff', async () => {
  const { branchA } = fixtureIds()
  await admin().from('line_outbox').insert({ branch_id: branchA, target_kind: 'group', target: `C${'2'.repeat(32)}`, kind: 'test', dedupe_key: `${RUN}:claim` })
  const claimed = await admin().rpc('claim_outbox', { p_limit: 100 })
  expect(claimed.error, claimed.error?.message).toBeNull()
  const mine = (claimed.data ?? []).find((r) => r.dedupe_key === `${RUN}:claim`)!
  expect(mine).toMatchObject({ status: 'sending', attempts: 1 })
  await admin().rpc('finish_outbox', { p_id: mine.id, p_status: 'failed', p_error: 'HTTP 500' })
  const { data: failed } = await admin().from('line_outbox').select('status, next_attempt_at, error').eq('id', mine.id).single()
  expect(failed?.status).toBe('failed')
  expect(new Date(failed!.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 50_000)
  const again = await admin().rpc('claim_outbox', { p_limit: 100 })
  expect((again.data ?? []).some((r) => r.id === mine.id)).toBe(false)
  await admin().from('line_outbox').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('id', mine.id)
  const third = await admin().rpc('claim_outbox', { p_limit: 100 })
  expect((third.data ?? []).find((r) => r.id === mine.id)?.attempts).toBe(2)
  await admin().rpc('finish_outbox', { p_id: mine.id, p_status: 'sent' })
  const { data: sent } = await admin().from('line_outbox').select('status, sent_at').eq('id', mine.id).single()
  expect(sent?.status).toBe('sent')
  expect(sent?.sent_at).not.toBeNull()
  expect((await dbAs('owner').rpc('claim_outbox', { p_limit: 1 })).error?.code).toBe('42501')
})

test('P1-OUT-03 bell: a received deposit notifies bar, not staff; nobody reads another user’s bell', async () => {
  const { users } = fixtureIds()
  const d = await mustCreate('staff', { qty: 1 })
  const { data: bar } = await dbAs('bar').from('notifications').select('kind, payload, link').eq('kind', 'deposit_received').contains('payload', { deposit_id: d.id })
  expect(bar).toHaveLength(1)
  expect(bar![0].link).toBe(`/deposits/${d.id}`)
  const { data: staff } = await dbAs('staff').from('notifications').select('id').contains('payload', { deposit_id: d.id })
  expect(staff).toEqual([])
  const { data: all } = await admin().from('notifications').select('user_id').contains('payload', { deposit_id: d.id })
  expect((all ?? []).map((n) => n.user_id)).not.toContain(users.staffB)
  const { data: peek } = await dbAs('staffB').from('notifications').select('id').eq('user_id', users.bar)
  expect(peek).toEqual([])
})

test('P1-OUT-04 print jobs: queue_print builds the payload from the deposit; no client inserts; other branch refused', async () => {
  const { branchA } = fixtureIds()
  const d = await mustCreate('staff', { qty: 2 })
  const q = await dbAs('staff').rpc('queue_print', { p_deposit: d.id, p_type: 'receipt' })
  expect(q.error, q.error?.message).toBeNull()
  const { data: job } = await admin().from('print_jobs').select('status, requested_by, branch_id, payload').eq('id', (q.data as { id: string }).id).single()
  expect(job).toMatchObject({ status: 'pending', requested_by: fixtureIds().users.staff, branch_id: branchA })
  // Davis print-server payload keys (RULINGS R-021)
  expect(job!.payload).toMatchObject({ deposit_code: d.code, quantity: 2, product_name: 'Johnnie Walker Black Label', table_number: 'A3' })
  expect((job!.payload as { link_code: string }).link_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  expect((job!.payload as { bottles: unknown[] }).bottles).toHaveLength(2)
  const raw = await dbAs('staff').from('print_jobs').insert({ branch_id: branchA, job_type: 'receipt', payload: { html: '<script>' } }).select('id')
  expect(raw.error?.code).toBe('42501')
  const b = await mustCreate('staffB', { qty: 1, branch: 'B' })
  expect((await dbAs('staff').rpc('queue_print', { p_deposit: b.id, p_type: 'label' })).error?.message).toContain('FORBIDDEN')
})

test('P1-OUT-10 a print account updates only its own branch jobs; staff cannot update jobs', async () => {
  const { branchA, branchB } = fixtureIds()
  const email = `print.${RUN.toLowerCase()}@staff.sis.local`
  const password = `Print-${Date.now()}-x`
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { print_branch: branchA, username: `print${Date.now() % 1e6}` } })
  expect(created.error).toBeNull()
  try {
    const jobA = (await admin().from('print_jobs').insert({ branch_id: branchA, job_type: 'label' }).select('id').single()).data!.id
    const jobB = (await admin().from('print_jobs').insert({ branch_id: branchB, job_type: 'label' }).select('id').single()).data!.id
    const printer = createClient<Database>(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } })
    expect((await printer.auth.signInWithPassword({ email, password })).error).toBeNull()
    // exactly the calls Davis's print-server makes (print-server/lib/supabase-connector.js)
    const pending = await printer.from('print_jobs').select('*').eq('branch_id', branchA).eq('status', 'pending').order('created_at').limit(500)
    expect((pending.data ?? []).map((j) => j.id)).toContain(jobA)
    const a = await printer.from('print_jobs').update({ status: 'completed', printed_at: new Date().toISOString() }).eq('id', jobA).select('id')
    expect(a.data).toHaveLength(1)
    const f = await printer.from('print_jobs').update({ status: 'failed', error_message: 'paper out' }).eq('id', jobA).select('id')
    expect(f.data).toHaveLength(1)
    const b = await printer.from('print_jobs').update({ status: 'completed' }).eq('id', jobB).select('id')
    expect(b.data ?? []).toHaveLength(0)
    const s = await dbAs('staff').from('print_jobs').update({ status: 'completed' }).eq('id', jobA).select('id')
    expect(s.data ?? []).toHaveLength(0)
    const settings = await printer.from('branches').select('receipt_settings, print_server_working_hours, print_server_printer_name').eq('id', branchA).single()
    expect(settings.error, settings.error?.message).toBeNull()
    const hb = await printer.from('print_stations').upsert({ branch_id: branchA, is_online: true, last_heartbeat: new Date().toISOString(), server_version: '2.0.0', printer_name: 'POS80', printer_status: 'ready', hostname: 'e2e', updated_at: new Date().toISOString() }, { onConflict: 'branch_id' })
    expect(hb.error, hb.error?.message).toBeNull()
    const hbB = await printer.from('print_stations').upsert({ branch_id: branchB, is_online: true }, { onConflict: 'branch_id' })
    expect(hbB.error).not.toBeNull()
    await printer.auth.signOut()
    await admin().from('print_stations').delete().in('branch_id', [branchA, branchB])
  } finally {
    await admin().auth.admin.deleteUser(created.data.user!.id)
  }
})

test('P1-OUT-05 P1-OUT-06 photos: private bucket, branch folders enforced', async () => {
  const { branchA, branchB } = fixtureIds()
  const path = `${branchA}/e2e/${RUN}.jpg`
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  const up = await dbAs('staff').storage.from('deposit-photos').upload(path, jpg, { contentType: 'image/jpeg' })
  expect(up.error, up.error?.message).toBeNull()
  try {
    const wrong = await dbAs('staff').storage.from('deposit-photos').upload(`${branchB}/e2e/${RUN}.jpg`, jpg, { contentType: 'image/jpeg' })
    expect(wrong.error).not.toBeNull()
    const pub = await fetch(`${required('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/deposit-photos/${path}`)
    expect([400, 404]).toContain(pub.status)
    const mine = await dbAs('staff').storage.from('deposit-photos').createSignedUrl(path, 60)
    expect(mine.error).toBeNull()
    const theirs = await dbAs('staffB').storage.from('deposit-photos').createSignedUrl(path, 60)
    expect(theirs.error).not.toBeNull()
  } finally {
    await admin().storage.from('deposit-photos').remove([path])
  }
})

test('P1-OUT-07 six sis-* cron jobs on UTC schedules', async () => {
  const rows = await sql<{ jobname: string; schedule: string }>("select jobname, schedule from cron.job where jobname like 'sis-%' order by jobname")
  expect(rows).toEqual([
    { jobname: 'sis-booking-reminders', schedule: '0 9 * * *' },
    { jobname: 'sis-expire-deposits', schedule: '7 * * * *' },
    { jobname: 'sis-expiry-notices', schedule: '0 5 * * *' },
    { jobname: 'sis-line-dispatch', schedule: '* * * * *' },
    { jobname: 'sis-no-shows', schedule: '*/5 * * * *' },
    { jobname: 'sis-retention', schedule: '30 20 * * *' },
  ])
})

test('P1-OUT-08 realtime: own branch topic subscribes and receives, other branch topic is refused', async () => {
  const { branchA, branchB } = fixtureIds()
  const tokens = JSON.parse(await (await import('node:fs/promises')).readFile('tests/e2e/.auth/tokens.json', 'utf8')) as Record<string, string>
  const rt = createClient<Database>(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } })
  await rt.realtime.setAuth(tokens.staff)
  const status = (topic: string, onMsg?: () => void) =>
    new Promise<string>((resolve) => {
      const ch = rt.channel(topic, { config: { private: true } })
      if (onMsg) ch.on('broadcast', { event: 'deposits' }, onMsg)
      ch.subscribe((s) => { if (s !== 'CLOSED') resolve(s) })
      setTimeout(() => resolve('TIMEOUT'), 15_000)
    })
  let got = 0
  expect(await status(`branch:${branchA}`, () => { got++ })).toBe('SUBSCRIBED')
  expect(await status(`branch:${branchB}`)).not.toBe('SUBSCRIBED')
  await mustCreate('staff', { qty: 1 })
  await expect.poll(() => got, { timeout: 15_000 }).toBeGreaterThan(0)
  await rt.removeAllChannels()
})
