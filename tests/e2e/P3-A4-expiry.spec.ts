import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds, sql } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { cleanupRun, confirmAll, deposit, mustCreate } from './fixtures/deposits'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import { renderMessage } from '../../src/lib/line/render'
import type { FlexComponent, FlexMessage, LineMessage } from '../../src/lib/line/flex'
import { cleanReminderDays, fillExpiryTemplate, unknownVariables } from '../../src/lib/line/expiry-template'
import { addDays, bangkokDate } from '../../src/lib/date'
import type { Database } from '../../src/types/database'
import cxTh from '../../messages/customer/th.json'
import cxEn from '../../messages/customer/en.json'
import cxZh from '../../messages/customer/zh.json'
import cxKo from '../../messages/customer/ko.json'

/**
 * P3-A4 — expiry reminders the owner shapes (R-044): the branch switch and each customer's, the
 * send time, up to three reminders and the wording per LIFF language. Runs the daily job for the
 * fixture branch only (run_expiry_notices(p_branch)); its LINE rows are skipped — no channel token.
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const TODAY = bangkokDate()
const STARTED = new Date().toISOString()
const SETTINGS = 'expiry_reminders_enabled, expiry_reminder_days, expiry_reminder_time, expiry_reminder_templates, withdrawal_blocked_days'
type BranchPatch = Database['public']['Tables']['branches']['Update']
let saved: BranchPatch | null = null

/** Bangkok noon, n days from today */
const inDays = (n: number) => `${addDays(TODAY, n)}T12:00:00+07:00`
const claimToday = (branchId: string) =>
  sql(`insert into private.expiry_notice_runs (branch_id, ran_on) values ('${branchId}', (now() at time zone 'Asia/Bangkok')::date)
       on conflict (branch_id) do update set ran_on = excluded.ran_on`)

test.beforeAll(async () => {
  const { branchA } = fixtureIds()
  saved = (await adminDb().from('branches').select(SETTINGS).eq('id', branchA).single()).data
  // the 5-minute cron leaves the fixture branch alone today — this spec runs it by hand
  await claimToday(branchA)
})

test.afterAll(async () => {
  const { branchA } = fixtureIds()
  if (saved) await adminDb().from('branches').update(saved).eq('id', branchA)
  await claimToday(branchA)
  await adminDb().from('line_outbox').delete().eq('branch_id', branchA).in('kind', ['expiry_soon', 'expired']).gte('created_at', STARTED)
  await cleanupRun()
  await cleanupCustomers()
})

async function settings(patch: BranchPatch) {
  const { error } = await adminDb().from('branches').update(patch).eq('id', fixtureIds().branchA)
  expect(error, error?.message).toBeNull()
}

/** the daily job for the fixture branch; forced = whatever its time and whether it ran today */
async function run(force = true) {
  const { data, error } = await adminDb().rpc('run_expiry_notices', { p_branch: fixtureIds().branchA, p_force: force })
  expect(error, error?.message).toBeNull()
  return data as number
}

/** a confirmed deposit of this customer that expires `days` from today (Bangkok) */
async function linkedDeposit(customerId: string, days: number, sent: number[] = []) {
  const d = await mustCreate('staff', { qty: 1, customerId })
  await confirmAll(d.id, [100])
  const { error } = await adminDb().from('deposits').update({ expires_at: inDays(days) }).eq('id', d.id)
  expect(error, error?.message).toBeNull()
  if (sent.length) await adminDb().from('deposits').update({ expiry_reminders_sent: sent }).eq('id', d.id)
  return d
}

const outbox = async (depositId: string, kind: 'expiry_soon' | 'expired' = 'expiry_soon') =>
  ((await adminDb().from('line_outbox').select('dedupe_key, payload, locale').eq('kind', kind).eq('payload->>deposit_id', depositId)).data ?? []) as {
    dedupe_key: string
    payload: Record<string, unknown>
    locale: string
  }[]

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P3-A4-01 /settings/branch: switch, time, three reminders, the wording per language with variables; saved as set and in the audit log', async ({ page, context }) => {
    const { branchA } = fixtureIds()
    await settings({ expiry_reminders_enabled: true, expiry_reminder_days: [7], expiry_reminder_time: '12:00', expiry_reminder_templates: {} })
    await context.addCookies([{ name: 'sis_branch', value: branchA, url: BASE_URL }])
    await page.goto('/settings/branch')
    const form = page.getByTestId('expiry-form')
    const area = form.getByTestId('expiry-text')
    const preview = form.getByTestId('expiry-preview')

    // the default wording, and a preview with sample values
    await expect(area).toHaveValue(cxTh.line.expiryReminder)
    await expect(preview).toContainText('Johnnie Walker Black Label')
    await expect(preview).not.toContainText('{{')

    // three reminders at most
    await form.getByTestId('expiry-day-0').fill('15')
    await form.getByTestId('expiry-add-day').click()
    await form.getByTestId('expiry-day-1').fill('7')
    await form.getByTestId('expiry-add-day').click()
    await form.getByTestId('expiry-day-2').fill('3')
    await expect(form.getByTestId('expiry-add-day')).toHaveCount(0)
    await form.getByTestId('expiry-time').fill('10:30')

    // a variable button puts {{day}} where the cursor is
    await area.fill('เหลือ ')
    await form.getByTestId('expiry-var-day').click()
    await expect(area).toHaveValue('เหลือ {{day}}')
    await area.fill('เหลือ {{day}} วัน · {{item}}')
    await expect(preview).toHaveText('เหลือ 15 วัน · Johnnie Walker Black Label')

    // an unknown variable is caught before saving; the default comes back with one press
    await form.getByTestId('expiry-lang-en').click()
    await form.getByTestId('expiry-text').fill('Hello {{name}}')
    await expect(form.getByTestId('expiry-text-state')).toContainText('{{name}}')
    await form.getByTestId('expiry-save').click()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'ไม่รู้จักตัวแปร' })).toBeVisible()
    await form.getByTestId('expiry-reset').click()
    await expect(form.getByTestId('expiry-text')).toHaveValue(cxEn.line.expiryReminder)

    await form.getByTestId('expiry-save').click()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'บันทึกแล้ว' })).toBeVisible()
    const { data } = await adminDb().from('branches').select('expiry_reminders_enabled, expiry_reminder_days, expiry_reminder_time, expiry_reminder_templates').eq('id', branchA).single()
    // only the edited language is stored — the others follow the default
    expect(data).toEqual({ expiry_reminders_enabled: true, expiry_reminder_days: [15, 7, 3], expiry_reminder_time: '10:30:00', expiry_reminder_templates: { th: 'เหลือ {{day}} วัน · {{item}}' } })
    const audit = (await adminDb().from('audit_log').select('details').eq('action', 'branch.updated').eq('target_id', branchA).order('id', { ascending: false }).limit(1)).data?.[0]
    expect(Object.keys(audit?.details ?? {})).toEqual(expect.arrayContaining(['expiry_reminder_days', 'expiry_reminder_time', 'expiry_reminder_templates.th']))

    // the branch switch
    await form.getByTestId('expiry-enabled').click()
    await form.getByTestId('expiry-save').click()
    await expect
      .poll(async () => (await adminDb().from('branches').select('expiry_reminders_enabled').eq('id', branchA).single()).data?.expiry_reminders_enabled)
      .toBe(false)
  })
})

test('P3-A4-02 reminders 15 · 7 · 3: one message per deposit per run, {{day}} = days left, the branch wording in the customer’s language, each reminder once', async () => {
  await settings({ expiry_reminders_enabled: true, expiry_reminder_days: [15, 7, 3], expiry_reminder_templates: { en: 'EN {{day}} days · {{item}}' } })
  const th = await makeCustomer({ locale: 'th' })
  const en = await makeCustomer({ locale: 'en' })
  const far = await linkedDeposit(th.id, 20)
  const at15 = await linkedDeposit(th.id, 15)
  const at10 = await linkedDeposit(en.id, 10)
  const at5 = await linkedDeposit(th.id, 5)
  const at3 = await linkedDeposit(th.id, 3, [15, 7])
  const unlinked = await mustCreate('staff', { qty: 1 })
  await confirmAll(unlinked.id, [100])
  await adminDb().from('deposits').update({ expires_at: inDays(3) }).eq('id', unlinked.id)

  await run()
  expect(await outbox(far.id)).toEqual([])
  expect(await outbox(unlinked.id)).toEqual([])
  const [r15] = await outbox(at15.id)
  expect(r15).toMatchObject({ locale: 'th', payload: { days: 15 } })
  expect(r15.payload.template).toBeUndefined() // Thai follows the default wording
  const r10 = await outbox(at10.id)
  expect(r10).toHaveLength(1) // the 15-day reminder, late: once, with the real days left
  expect(r10[0]).toMatchObject({ locale: 'en', payload: { days: 10, template: 'EN {{day}} days · {{item}}' } })
  const r5 = await outbox(at5.id)
  expect(r5).toHaveLength(1) // 15 and 7 both due → one message
  expect(r5[0].payload).toMatchObject({ days: 5 })
  expect(((await deposit(at5.id)).expiry_reminders_sent as number[]).sort((a, b) => a - b)).toEqual([7, 15])
  const r3 = await outbox(at3.id)
  expect(r3).toHaveLength(1)
  expect(r3[0].dedupe_key).toMatch(/:3$/)

  // the same day again: nothing new
  await run()
  for (const d of [at15, at10, at5, at3]) expect(await outbox(d.id)).toHaveLength(1)

  // a new expiry date (extend) starts the reminders over
  await adminDb().from('deposits').update({ expires_at: inDays(40) }).eq('id', at5.id)
  expect((await deposit(at5.id)).expiry_reminders_sent).toEqual([])
})

test('P3-A4-03 switched off for the branch or one customer: nothing sent and the reminder dropped; "หมดอายุแล้ว" leaves at the run for a fresh expiry, never for a stale one', async () => {
  await settings({ expiry_reminders_enabled: false, expiry_reminder_days: [7], expiry_reminder_templates: {}, withdrawal_blocked_days: [] })
  const c = await makeCustomer()
  const off = await linkedDeposit(c.id, 7)
  await run()
  expect(await outbox(off.id)).toEqual([])
  expect((await deposit(off.id)).expiry_reminders_sent).toEqual([7]) // dropped, not saved up
  await settings({ expiry_reminders_enabled: true })
  await run()
  expect(await outbox(off.id)).toEqual([])

  const quiet = await makeCustomer()
  await adminDb().from('customers').update({ expiry_notices_enabled: false }).eq('id', quiet.id)
  const q = await linkedDeposit(quiet.id, 7)
  await run()
  expect(await outbox(q.id)).toEqual([])

  // expired: with no blocked days the deadline is 04:00 the day after the expiry date
  const bkkHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const lastNight = addDays(TODAY, bkkHour >= 4 ? -1 : -2) // its deadline has passed, less than two days ago
  const expireAt = async (customerId: string, night: string) => {
    const d = await linkedDeposit(customerId, 20)
    await adminDb().from('deposits').update({ expires_at: `${night}T12:00:00+07:00` }).eq('id', d.id)
    return d
  }
  const fresh = await expireAt(c.id, lastNight)
  const stale = await expireAt(c.id, addDays(TODAY, -6))
  const quietExpired = await expireAt(quiet.id, lastNight)
  expect((await adminDb().rpc('expire_due_deposits')).error).toBeNull()
  for (const d of [fresh, stale, quietExpired]) expect((await deposit(d.id)).status).toBe('expired')
  expect(await outbox(fresh.id, 'expired')).toEqual([]) // not at the hour it expired
  await run()
  expect(await outbox(fresh.id, 'expired')).toHaveLength(1)
  expect((await deposit(fresh.id)).expired_notice_sent_at).not.toBeNull()
  expect(await outbox(stale.id, 'expired')).toEqual([])
  expect(await outbox(quietExpired.id, 'expired')).toEqual([])
})

test('P3-A4-04 each branch runs once a day, at or after its own time', async () => {
  const { branchA } = fixtureIds()
  await settings({ expiry_reminders_enabled: true, expiry_reminder_days: [7], expiry_reminder_time: '23:59', expiry_reminder_templates: {}, withdrawal_blocked_days: [] })
  await sql(`delete from private.expiry_notice_runs where branch_id = '${branchA}'`)
  const c = await makeCustomer()
  const due = await linkedDeposit(c.id, 7)
  const bkkNow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  if (bkkNow < '23:59') {
    await run(false)
    expect(await outbox(due.id)).toEqual([]) // not its time yet
  }
  await settings({ expiry_reminder_time: '00:00' })
  await run(false)
  expect(await outbox(due.id)).toHaveLength(1)
  // the day is taken: a deposit that falls due later today waits for tomorrow's run
  const later = await linkedDeposit(c.id, 7)
  await run(false)
  expect(await outbox(later.id)).toEqual([])
  const [row] = await sql<{ ran_on: string }>(`select ran_on::text as ran_on from private.expiry_notice_runs where branch_id = '${branchA}'`)
  expect(row.ran_on).toBe(TODAY)
})

test('P3-A4-05 the wording: the branch’s or the default, every language filled, variables filled once', () => {
  const texts = (m: LineMessage | null) => {
    expect(m?.type).toBe('flex')
    const out: string[] = []
    const walk = (c: FlexComponent) => {
      if (c.type === 'text') out.push(c.text)
      else if (c.type === 'box') c.contents.forEach(walk)
    }
    const f = m as FlexMessage
    for (const box of [f.contents.header, f.contents.body, f.contents.footer]) if (box) walk(box)
    return out.join(' ')
  }
  const PAY = { deposit_id: '7a0e8a52-2b1c-4c1e-9d55-0c3b1d0f6a11', code: 'DEP-ZTA-ABC23', item: 'Johnnie Walker Black Label', quantity: 1, remaining: 1, expires_at: '2026-10-23T17:30:00Z', deadline: '2026-10-24T21:00:00Z', days: 3 }
  const DEFAULTS = { th: cxTh, en: cxEn, zh: cxZh, ko: cxKo }
  for (const [loc, cat] of Object.entries(DEFAULTS)) {
    for (const v of ['day', 'item', 'code', 'date', 'deadline']) expect(cat.line.expiryReminder, `${loc} default has {{${v}}}`).toContain(`{{${v}}}`)
    const body = texts(renderMessage('expiry_soon', loc, PAY, { branchName: 'E2E-A' }))
    expect(body, loc).toContain('Johnnie Walker Black Label')
    expect(body, loc).toContain('DEP-ZTA-ABC23')
    expect(body, loc).not.toContain('{{')
  }
  expect(texts(renderMessage('expiry_soon', 'en', PAY, {}))).toContain('days left: 3')
  expect(texts(renderMessage('expiry_soon', 'en', PAY, {}))).toContain('25 Oct 2026 04:00')

  const own = texts(renderMessage('expiry_soon', 'th', { ...PAY, template: 'เหลือ {{day}} วัน · {{item}} · {{branch}} · {{code}}' }, { branchName: 'E2E-A' }))
  expect(own).toContain('เหลือ 3 วัน')
  expect(own).toContain('E2E-A')
  // a value that looks like a variable stays text
  expect(texts(renderMessage('expiry_soon', 'en', { ...PAY, item: '{{day}} Whisky' }, {}))).toContain('{{day}} Whisky')

  expect(unknownVariables('{{day}} {{foo}} {{ ITEM }}')).toEqual(['foo'])
  expect(fillExpiryTemplate('{{day}}/{{nope}}', { day: '5' })).toBe('5/{{nope}}')
  expect(cleanReminderDays([3, 15, 7])).toEqual([15, 7, 3])
  for (const bad of [[7, 7], [0], [91], [1, 2, 3, 4], []]) expect(cleanReminderDays(bad), JSON.stringify(bad)).toBeNull()
})

test.describe('bar', () => {
  test.use({ storageState: as('bar') })

  test('P3-A4-06 bar turns one customer off on the deposit page (audited); staff see the state, no switch, and cannot call it', async ({ page, context, browser }) => {
    const { branchA, users } = fixtureIds()
    await context.addCookies([{ name: 'sis_branch', value: branchA, url: BASE_URL }])
    const c = await makeCustomer()
    const d = await linkedDeposit(c.id, 20)
    await page.goto(`/deposits/${d.id}`)
    const row = page.getByTestId('customer-reminders')
    await expect(row).toHaveAttribute('data-on', 'true')
    await row.getByTestId('customer-reminders-switch').click()
    await expect(row).toHaveAttribute('data-on', 'false')
    expect((await adminDb().from('customers').select('expiry_notices_enabled').eq('id', c.id).single()).data?.expiry_notices_enabled).toBe(false)
    const audit = (await adminDb().from('audit_log').select('action, actor_id, details').eq('target_id', c.id).order('id', { ascending: false }).limit(1)).data?.[0]
    expect(audit).toMatchObject({ action: 'customer.reminders_off', actor_id: users.bar, details: { expiry_notices_enabled: [true, false], deposit: d.code } })

    const staff = await browser.newContext({ storageState: as('staff') })
    await staff.addCookies([{ name: 'sis_branch', value: branchA, url: BASE_URL }])
    const onStaff = await staff.newPage()
    await onStaff.goto(`/deposits/${d.id}`)
    await expect(onStaff.getByTestId('customer-reminders')).toHaveAttribute('data-on', 'false')
    await expect(onStaff.getByTestId('customer-reminders-switch')).toHaveCount(0)
    await staff.close()
    expect((await dbAs('staff').rpc('set_customer_expiry_notices', { p_deposit: d.id, p_enabled: true })).error).not.toBeNull()
  })
})
