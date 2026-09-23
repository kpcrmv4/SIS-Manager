import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { adminDb, clearLocalLoginThrottle, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR, required } from './fixtures/env'
import { mustCreate, cleanupRun } from './fixtures/deposits'
import { cleanupPrintStation } from './fixtures/p3b-print'

const run = promisify(execFile)
const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const admin = () => adminDb()

test.describe.configure({ mode: 'serial' })

let branchA = ''
let branchB = ''
let branchACode = ''
let printAccountId = ''
let printCreds: { email: string; password: string } | null = null

test.beforeAll(async () => {
  await clearLocalLoginThrottle() // the print-account login checks must not hit the per-IP throttle
  const ids = fixtureIds()
  branchA = ids.branchA
  branchB = ids.branchB
  const { data } = await admin().from('branches').select('code').eq('id', branchA).single()
  branchACode = data!.code
  await cleanupPrintStation(admin(), branchA)
})

test.afterAll(async () => {
  await cleanupPrintStation(admin(), branchA)
  await cleanupRun()
})

async function zipConfig(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf)
  const entry = zip.file('print-server/config.json')
  expect(entry).not.toBeNull()
  return { zip, config: JSON.parse(await entry!.async('string')) as Record<string, unknown> }
}

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P3-B2-01 P3-B2-03 setup: ZIP with config.json + print-server files; account app_metadata/profile/user_branches', async ({ request }) => {
    const res = await request.post('/api/print-server/setup', { data: { branchId: branchA } })
    expect(res.status(), await res.text().catch(() => '')).toBe(200)
    expect(res.headers()['content-type']).toContain('application/zip')

    const { zip, config } = await zipConfig(await res.body())
    expect(config.STORE_ID).toBe(branchA)
    expect(config.PRINT_ACCOUNT_EMAIL).toBe(`printer-${branchACode.toLowerCase()}@print.sis.local`)
    expect(typeof config.PRINT_ACCOUNT_PASSWORD).toBe('string')
    expect((config.PRINT_ACCOUNT_PASSWORD as string).length).toBeGreaterThanOrEqual(16)
    expect(zip.file('print-server/print-server.js')).not.toBeNull()
    expect(zip.file('print-server/lib/html-renderer.js')).not.toBeNull()
    expect(zip.file('print-server/lib/supabase-connector.js')).not.toBeNull()
    expect(zip.file('print-server/lib/qr.js')).not.toBeNull()

    const { data: station } = await admin().from('print_stations').select('account_id').eq('branch_id', branchA).single()
    printAccountId = station!.account_id!
    expect(printAccountId).toBeTruthy()

    const { data: authUser } = await admin().auth.admin.getUserById(printAccountId)
    expect((authUser.user?.app_metadata as Record<string, unknown> | undefined)?.print_branch).toBe(branchA)

    const { data: profile } = await admin().from('profiles').select('active').eq('id', printAccountId).single()
    expect(profile?.active).toBe(false)

    const { count } = await admin().from('user_branches').select('branch_id', { count: 'exact', head: true }).eq('user_id', printAccountId)
    expect(count ?? 0).toBe(0)

    // the print account cannot sign in to the staff app: valid credentials, inactive profile → 403
    // (the `request` fixture here still carries the owner's session cookies, but /api/auth/login
    // signs in as whatever `identifier`/`password` are given — the caller's own session is irrelevant)
    const loginRes = await request.post('/api/auth/login', { data: { identifier: config.PRINT_ACCOUNT_EMAIL, password: config.PRINT_ACCOUNT_PASSWORD } })
    expect(loginRes.status()).toBe(403)
    expect((await loginRes.json()).error).toBe('inactive')
  })

  test('P3-B2-05 running setup again keeps the same account and resets the password', async ({ request }) => {
    const res1 = await request.post('/api/print-server/setup', { data: { branchId: branchA } })
    expect(res1.status()).toBe(200)
    const { config: config1 } = await zipConfig(await res1.body())

    const res2 = await request.post('/api/print-server/setup', { data: { branchId: branchA } })
    expect(res2.status()).toBe(200)
    const { config: config2 } = await zipConfig(await res2.body())

    expect(config2.PRINT_ACCOUNT_EMAIL).toBe(config1.PRINT_ACCOUNT_EMAIL)
    expect(config2.PRINT_ACCOUNT_PASSWORD).not.toBe(config1.PRINT_ACCOUNT_PASSWORD)

    const { data: station } = await admin().from('print_stations').select('account_id').eq('branch_id', branchA).single()
    expect(station!.account_id).toBe(printAccountId)

    // the old password stops working immediately
    const stale = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } })
    const { error } = await stale.auth.signInWithPassword({ email: config1.PRINT_ACCOUNT_EMAIL as string, password: config1.PRINT_ACCOUNT_PASSWORD as string })
    expect(error).not.toBeNull()

    // keep the account on the CURRENT password for the tests below
    printCreds = { email: config2.PRINT_ACCOUNT_EMAIL as string, password: config2.PRINT_ACCOUNT_PASSWORD as string }
  })

  test('P3-B2-03 a re-activated print profile still cannot use the staff app; users admin refuses it; setup switches it off again', async ({ request }) => {
    // someone flips the profile back on (the owner could, before this fix, from ผู้ใช้และสาขา)
    await admin().from('profiles').update({ active: true }).eq('id', printAccountId)
    const login = await request.post('/api/auth/login', { data: { identifier: printCreds!.email, password: printCreds!.password } })
    expect(login.status()).toBe(403)
    expect((await login.json()).error).toBe('inactive')

    for (const data of [
      { action: 'update', userId: printAccountId, active: true, role: 'owner' },
      { action: 'reset_password', userId: printAccountId, password: 'Whatever123' },
    ]) {
      const res = await request.post('/api/admin/users', { data })
      expect(res.status(), JSON.stringify(data)).toBe(422)
      expect((await res.json()).error).toBe('print_account')
    }

    // re-running setup deactivates it again (and rotates the password)
    const setup = await request.post('/api/print-server/setup', { data: { branchId: branchA } })
    expect(setup.status()).toBe(200)
    const zip = await JSZip.loadAsync(await setup.body())
    const config = JSON.parse(await zip.file('print-server/config.json')!.async('string')) as Record<string, unknown>
    printCreds = { email: config.PRINT_ACCOUNT_EMAIL as string, password: config.PRINT_ACCOUNT_PASSWORD as string }
    const { data: profile } = await admin().from('profiles').select('active').eq('id', printAccountId).single()
    expect(profile?.active).toBe(false)
  })
})

// Separate describes (not nested under the owner's test.use) so the `request` fixture is
// truly unauthenticated / staff / bar for each — mirrors P2-C1.spec.ts and P2-B3.spec.ts.
test.describe('P3-B2-02 anon', () => {
  test('P3-B2-02 anon cannot set up a print station (401)', async ({ request }) => {
    const res = await request.post('/api/print-server/setup', { data: { branchId: branchA } })
    expect(res.status()).toBe(401)
  })
})

for (const role of ['staff', 'bar'] as const) {
  test.describe(`P3-B2-02 ${role}`, () => {
    test.use({ storageState: as(role) })
    test(`P3-B2-02 ${role} cannot set up a print station (403)`, async ({ request }) => {
      const res = await request.post('/api/print-server/setup', { data: { branchId: branchA } })
      expect(res.status(), role).toBe(403)
    })
  })
}

test.describe('print account', () => {
  test('P3-B2-04 reads its own branch pending jobs, updates status, heartbeat upserts; other branch invisible', async () => {
    expect(printCreds, 'P3-B2-05 must run first to leave a known password').not.toBeNull()

    const depositA = await mustCreate('owner', { branch: 'A' })
    const { data: jobA, error: jobAError } = await dbAs('owner').rpc('queue_print', { p_deposit: depositA.id, p_type: 'label' })
    expect(jobAError, jobAError?.message).toBeNull()

    const depositB = await mustCreate('owner', { branch: 'B' })
    const { data: jobB, error: jobBError } = await dbAs('owner').rpc('queue_print', { p_deposit: depositB.id, p_type: 'label' })
    expect(jobBError, jobBError?.message).toBeNull()

    const printDb = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } })
    const { error: signInError } = await printDb.auth.signInWithPassword({ email: printCreds!.email, password: printCreds!.password })
    expect(signInError, signInError?.message).toBeNull()

    const { data: ownJobs, error: ownJobsError } = await printDb.from('print_jobs').select('id, status').eq('branch_id', branchA).eq('status', 'pending')
    expect(ownJobsError, ownJobsError?.message).toBeNull()
    expect(ownJobs!.some((j) => j.id === (jobA as { id: string }).id)).toBe(true)

    const { data: printingRow, error: printingError } = await printDb.from('print_jobs').update({ status: 'printing' }).eq('id', (jobA as { id: string }).id).select('status').single()
    expect(printingError, printingError?.message).toBeNull()
    expect(printingRow?.status).toBe('printing')

    const { data: doneRow, error: doneError } = await printDb.from('print_jobs').update({ status: 'completed', printed_at: new Date().toISOString() }).eq('id', (jobA as { id: string }).id).select('status').single()
    expect(doneError, doneError?.message).toBeNull()
    expect(doneRow?.status).toBe('completed')

    const { error: heartbeatError } = await printDb.from('print_stations').upsert(
      { branch_id: branchA, is_online: true, last_heartbeat: new Date().toISOString(), server_version: 'e2e', printer_name: 'POS80', printer_status: 'ready', hostname: 'e2e-host', error_message: null, updated_at: new Date().toISOString() },
      { onConflict: 'branch_id' },
    )
    expect(heartbeatError, heartbeatError?.message).toBeNull()

    // branch B is invisible and not updatable through this account's RLS
    const { data: otherBranchJobs, error: otherReadError } = await printDb.from('print_jobs').select('id').eq('branch_id', branchB)
    expect(otherReadError, otherReadError?.message).toBeNull()
    expect(otherBranchJobs).toHaveLength(0)

    const { data: otherUpdateRows, error: otherUpdateError } = await printDb.from('print_jobs').update({ status: 'printing' }).eq('id', (jobB as { id: string }).id).select('id')
    expect(otherUpdateError, otherUpdateError?.message).toBeNull()
    expect(otherUpdateRows).toHaveLength(0)
    const { data: jobBAfter } = await admin().from('print_jobs').select('status').eq('id', (jobB as { id: string }).id).single()
    expect(jobBAfter?.status).toBe('pending')
  })

  test('P3-B2-06 connector smoke: supabase-connector.js picks up a pending job and completes it', async () => {
    expect(printCreds, 'P3-B2-05 must run first to leave a known password').not.toBeNull()

    const deposit = await mustCreate('owner', { branch: 'A' })
    const { data: job, error } = await dbAs('owner').rpc('queue_print', { p_deposit: deposit.id, p_type: 'receipt' })
    expect(error, error?.message).toBeNull()
    const jobId = (job as { id: string }).id

    const { stdout } = await run('node', ['scripts/print-connector-smoke.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SUPABASE_URL: required('NEXT_PUBLIC_SUPABASE_URL'),
        SUPABASE_ANON_KEY: required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
        STORE_ID: branchA,
        PRINT_ACCOUNT_EMAIL: printCreds!.email,
        PRINT_ACCOUNT_PASSWORD: printCreds!.password,
        JOB_ID: jobId,
      },
    })
    const line = stdout.split('\n').find((l) => l.startsWith('RESULT:'))
    expect(line, stdout).toBeTruthy()
    const result = JSON.parse(line!.slice('RESULT:'.length)) as { ok: boolean; pickedUp?: boolean; error?: string }
    expect(result.ok, result.error).toBe(true)
    expect(result.pickedUp).toBe(true)

    const { data: after } = await admin().from('print_jobs').select('status').eq('id', jobId).single()
    expect(after?.status).toBe('completed')
  })
})
