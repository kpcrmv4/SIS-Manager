import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, test, type BrowserContext } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { cleanupRun, deposit, mustCreate } from './fixtures/deposits'
import {
  LIFF_ID,
  MockLine,
  RUN,
  SECRET,
  TOKEN,
  cleanupLine,
  configureBranches,
  dispatchUntilDone,
  groupId,
  lineUserId,
  postWebhook,
  textEvent,
} from './fixtures/p3a-line'
import { BRANCH_A_CODE } from './fixtures/users'

/** this fixture's branch A code — the webhook path segment (lower case) */
const A_CODE = BRANCH_A_CODE.toLowerCase()

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const mock = new MockLine()
const lineIds: string[] = []
const PHOTO_PATH = join(tmpdir(), `p3a2-${Date.now()}.jpg`)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  writeFileSync(PHOTO_PATH, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]))
  await mock.start()
  await configureBranches()
})

test.afterAll(async () => {
  await mock.stop()
  await cleanupRun()
  await cleanupLine(lineIds)
})

/** L-006: the owner sees every branch — pin the fixture branch explicitly. */
async function pinBranchA(context: BrowserContext) {
  await context.addCookies([{ name: 'sis_branch', value: fixtureIds().branchA, url: BASE_URL }])
}

async function queue(branch: 'A' | 'B', target: string, kind = 'deposit_confirmed', key = `${RUN}:${target}`) {
  const { branchA, branchB } = fixtureIds()
  const { data, error } = await adminDb()
    .from('line_outbox')
    .insert({
      branch_id: branch === 'A' ? branchA : branchB,
      target_kind: 'user',
      target,
      kind,
      locale: 'en',
      payload: { code: 'DEP-ZAA-ABC23', item: `${RUN} Hennessy`, quantity: 2, remaining: 2, expires_at: '2026-12-01T10:00:00Z' },
      dedupe_key: key,
    })
    .select('id')
    .single()
  expect(error, error?.message).toBeNull()
  return { id: data!.id, key }
}

async function outbox(key: string) {
  const { data, error } = await adminDb().from('line_outbox').select('id, status, error, sent_at, next_attempt_at, attempts').eq('dedupe_key', key).single()
  expect(error, error?.message).toBeNull()
  return data!
}

test('P3-A2-01 cron dispatch without / with a wrong CRON_SECRET → 401, nothing claimed', async ({ request }) => {
  const target = lineUserId()
  lineIds.push(target)
  const row = await queue('A', target)
  expect((await request.post('/api/cron/line-dispatch')).status()).toBe(401)
  expect((await request.post('/api/cron/line-dispatch', { headers: { authorization: 'Bearer wrong-secret-wrong-secret' } })).status()).toBe(401)
  const after = await outbox(row.key)
  expect(after).toMatchObject({ status: 'queued', attempts: 0 })
  expect(mock.pushesTo(target)).toHaveLength(0)
})

test('P3-A2-02 queued rows go to LINE with the branch token → sent, sent_at set', async ({ request }) => {
  const target = lineIds[0]
  const row = await outbox(`${RUN}:${target}`)
  await dispatchUntilDone(request, `${RUN}:${target}`)
  const done = await outbox(`${RUN}:${target}`)
  expect(done.status).toBe('sent')
  expect(done.sent_at).not.toBeNull()
  const pushes = mock.pushesTo(target)
  expect(pushes).toHaveLength(1)
  expect(pushes[0].auth).toBe(`Bearer ${TOKEN}`)
  expect(pushes[0].retryKey).toBe(row.id)
  const [message] = pushes[0].body!.messages as { type: string; altText: string; contents: { footer?: { contents: { action: { uri: string } }[] } } }[]
  expect(message.type).toBe('flex')
  expect(message.altText).toContain(`${RUN} Hennessy`)
  expect(message.altText).toContain('Deposit stored') // locale en
  expect(message.contents.footer?.contents[0].action.uri).toBe(`https://liff.line.me/${LIFF_ID}`)
})

test('P3-A2-03 a branch without a token → skipped with the reason, no LINE call', async ({ request }) => {
  const target = lineUserId()
  lineIds.push(target)
  const row = await queue('B', target)
  await dispatchUntilDone(request, row.key)
  const done = await outbox(row.key)
  expect(done.status).toBe('skipped')
  expect(done.error).toContain('no_token')
  expect(mock.pushesTo(target)).toHaveLength(0)
})

test('P3-A2-04 LINE 500 / 429 → failed with backoff; 400 → skipped (permanent)', async ({ request }) => {
  const t500 = lineUserId()
  const t429 = lineUserId()
  const t400 = lineUserId()
  lineIds.push(t500, t429, t400)
  mock.pushStatus.set(t500, 500)
  mock.pushStatus.set(t429, 429)
  mock.pushStatus.set(t400, 400)
  const rows = [await queue('A', t500), await queue('A', t429), await queue('A', t400)]
  for (const r of rows) await dispatchUntilDone(request, r.key)
  const now = Date.now()
  for (const r of rows.slice(0, 2)) {
    const done = await outbox(r.key)
    expect(done.status).toBe('failed')
    expect(new Date(done.next_attempt_at).getTime()).toBeGreaterThan(now)
    expect(done.error).toMatch(/HTTP (500|429)/)
  }
  const bad = await outbox(rows[2].key)
  expect(bad.status).toBe('skipped')
  expect(bad.error).toContain('HTTP 400')
  expect(bad.error).toContain('mock 400')
  expect(mock.pushesTo(t500)).toHaveLength(1)
})

test.describe('bar', () => {
  test.use({ storageState: as('bar') })

  test('P3-A2-05 bar confirms a LINE-linked deposit → delivered by the inline after() dispatch (no cron)', async ({ page }) => {
    const line = lineUserId()
    lineIds.push(line)
    const { data: customer, error } = await adminDb().from('customers').insert({ line_user_id: line, display_name: `${RUN} linked`, locale: 'th' }).select('id').single()
    expect(error, error?.message).toBeNull()
    const dep = await mustCreate('staff', { qty: 1, customerId: customer!.id })
    await page.goto(`/deposits/${dep.id}`)
    await page.getByTestId('action-confirm').click()
    await page.getByTestId('confirm-level-1').fill('100')
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('confirm-photo-add').click()
    await (await chooser).setFiles(PHOTO_PATH)
    await expect(page.getByTestId('photo-chip').first()).toBeVisible()
    await page.getByRole('button', { name: 'ยืนยันเก็บเข้าชั้น', exact: true }).click()
    await expect(page.getByText('ยืนยันเหล้าแล้ว', { exact: true })).toBeVisible()
    expect((await deposit(dep.id)).status).toBe('in_store')
    await expect.poll(() => mock.pushesTo(line).length, { timeout: 30_000 }).toBe(1)
    const { data: row } = await adminDb().from('line_outbox').select('status, sent_at').eq('dedupe_key', `deposit_confirmed:${dep.id}`).single()
    expect(row).toMatchObject({ status: 'sent' })
    const msg = (mock.pushesTo(line)[0].body!.messages as { altText: string }[])[0]
    expect(msg.altText).toContain('รับฝากเรียบร้อย')
  })

  test('P3-A2-07 /settings/line is 404 for bar; the owner-only RPCs refuse', async ({ page }) => {
    const res = await page.goto('/settings/line')
    expect(res?.status()).toBe(404)
    const { branchA } = fixtureIds()
    expect((await dbAs('bar').rpc('new_group_bind_code', { p_branch: branchA })).error?.message).toContain('FORBIDDEN')
    expect((await dbAs('bar').rpc('send_line_test', { p_branch: branchA })).error?.message).toContain('FORBIDDEN')
    const { error } = await dbAs('bar').from('branch_line_secrets').select('channel_secret').limit(1)
    expect(error?.code).toBe('42501')
  })
})

test.describe('staff', () => {
  test.use({ storageState: as('staff') })

  test('P3-A2-07 /settings/line is 404 for staff', async ({ page }) => {
    const res = await page.goto('/settings/line')
    expect(res?.status()).toBe(404)
    expect((await dbAs('staff').rpc('new_group_bind_code', { p_branch: fixtureIds().branchA })).error?.message).toContain('FORBIDDEN')
  })
})

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P3-A2-06 owner saves LIFF id, channel id, OA id, token, secret; secrets never reach the browser', async ({ page, context }) => {
    await pinBranchA(context)
    const { branchA } = fixtureIds()
    // start from nothing so the form proves it writes every field
    await adminDb().from('branch_line_secrets').delete().eq('branch_id', branchA)
    await adminDb().from('branches').update({ liff_id: null, line_channel_id: null, line_bot_user_id: null }).eq('id', branchA)

    await page.goto('/settings/line')
    await expect(page.getByTestId('line-settings')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('line-accessToken-status')).toHaveText('ยังไม่ได้ตั้งค่า')
    await expect(page.getByTestId('line-webhook-url')).toHaveText(new RegExp(`/api/line/webhook/${A_CODE}$`))
    // the LIFF endpoint is the branch's customer app — never the site root (that is the staff login)
    await expect(page.getByTestId('line-liff-endpoint')).toHaveText(new RegExp(`^https?://[^/]+/liff/${A_CODE}$`))
    await page.locator('#line-liffId').fill(LIFF_ID)
    await page.locator('#line-channelId').fill('2001234567')
    await page.locator('#line-botUserId').fill('e2e.sis')
    await page.locator('#line-accessToken').fill(TOKEN)
    await page.locator('#line-channelSecret').fill(SECRET)
    await page.getByTestId('line-save').click()
    await expect(page.getByText('บันทึกแล้ว', { exact: true })).toBeVisible()

    const { data: b } = await adminDb().from('branches').select('liff_id, line_channel_id, line_bot_user_id').eq('id', branchA).single()
    expect(b).toEqual({ liff_id: LIFF_ID, line_channel_id: '2001234567', line_bot_user_id: '@e2e.sis' })
    const { data: s } = await adminDb().from('branch_line_secrets').select('channel_access_token, channel_secret').eq('branch_id', branchA).single()
    expect(s).toEqual({ channel_access_token: TOKEN, channel_secret: SECRET })

    const res = await page.goto('/settings/line')
    const html = await res!.text()
    expect(html).not.toContain(TOKEN)
    expect(html).not.toContain(SECRET)
    await expect(page.getByTestId('line-settings')).toHaveAttribute('data-hydrated', 'true')
    expect(await page.content()).not.toContain(SECRET)
    await expect(page.getByTestId('line-accessToken-status')).toHaveText('ตั้งค่าแล้ว (ซ่อนไว้)')
    await expect(page.getByTestId('line-channelSecret-status')).toHaveText('ตั้งค่าแล้ว (ซ่อนไว้)')
    await expect(page.locator('#line-accessToken')).toHaveValue('')

    // blank secret fields keep the stored values; a malformed LIFF id is refused
    await page.locator('#line-liffId').fill('not a liff id')
    await page.getByTestId('line-save').click()
    await expect(page.getByText('รูปแบบ LIFF ID ไม่ถูกต้อง')).toBeVisible()
    await page.locator('#line-liffId').fill(LIFF_ID)
    await page.getByTestId('line-save').click()
    await expect(page.getByText('บันทึกแล้ว', { exact: true })).toBeVisible()
    const { data: s2 } = await adminDb().from('branch_line_secrets').select('channel_access_token, channel_secret').eq('branch_id', branchA).single()
    expect(s2).toEqual({ channel_access_token: TOKEN, channel_secret: SECRET })
  })

  test('P3-A2-08 bind the staff group: code from the page, typed in the group → staff_group_id; expired / wrong code does nothing', async ({ page, context, request }) => {
    await pinBranchA(context)
    const { branchA } = fixtureIds()
    const group = groupId()
    await page.goto('/settings/line')
    await expect(page.getByTestId('line-settings')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('line-group-status')).toHaveText('ยังไม่ได้ผูกกลุ่ม')

    // expired code
    await page.getByTestId('line-make-code').click()
    const shown = (await page.getByTestId('line-bind-code').locator('p').first().textContent())!.trim()
    expect(shown).toMatch(/^SIS-[A-HJ-NP-Z2-9]{8}$/)
    const { data: sec } = await adminDb().from('branch_line_secrets').select('group_bind_code').eq('branch_id', branchA).single()
    expect(sec!.group_bind_code).toBe(shown)
    await adminDb().from('branch_line_secrets').update({ group_bind_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('branch_id', branchA)
    const expired = textEvent({ type: 'group', groupId: group }, shown)
    expect((await postWebhook(request, A_CODE, { destination: 'x', events: [expired] }, SECRET)).status()).toBe(200)
    let { data: b } = await adminDb().from('branches').select('staff_group_id').eq('id', branchA).single()
    expect(b!.staff_group_id).toBeNull()
    expect(mock.repliesTo(expired.replyToken)).toHaveLength(0)

    // fresh code: a wrong one first, then the right one typed loosely
    await page.getByTestId('line-make-code').click()
    await expect(page.getByTestId('line-bind-code').locator('p').first()).not.toHaveText(shown)
    const code = (await page.getByTestId('line-bind-code').locator('p').first().textContent())!.trim()
    const wrong = textEvent({ type: 'group', groupId: group }, code === 'SIS-AAAAAAAA' ? 'SIS-BBBBBBBB' : 'SIS-AAAAAAAA')
    await postWebhook(request, A_CODE, { destination: 'x', events: [wrong] }, SECRET)
    ;({ data: b } = await adminDb().from('branches').select('staff_group_id').eq('id', branchA).single())
    expect(b!.staff_group_id).toBeNull()
    const right = textEvent({ type: 'group', groupId: group }, ` ${code.toLowerCase().replace('-', '- ')} `)
    expect((await postWebhook(request, A_CODE, { destination: 'x', events: [right] }, SECRET)).status()).toBe(200)
    ;({ data: b } = await adminDb().from('branches').select('staff_group_id').eq('id', branchA).single())
    expect(b!.staff_group_id).toBe(group)
    expect(mock.repliesTo(right.replyToken)).toHaveLength(1)
    // the code is single-use
    const reuse = textEvent({ type: 'group', groupId: groupId() }, code)
    await postWebhook(request, A_CODE, { destination: 'x', events: [reuse] }, SECRET)
    ;({ data: b } = await adminDb().from('branches').select('staff_group_id').eq('id', branchA).single())
    expect(b!.staff_group_id).toBe(group)

    await page.reload()
    await expect(page.getByTestId('line-group-status')).toHaveText('ผูกกลุ่มแล้ว')
  })

  test('P3-A2-08 ten wrong bind codes burn the open code (no brute force)', async () => {
    const { branchA } = fixtureIds()
    const { data: made, error } = await dbAs('owner').rpc('new_group_bind_code', { p_branch: branchA })
    expect(error, error?.message).toBeNull()
    const code = (made as { code: string }).code
    const before = (await adminDb().from('branches').select('staff_group_id').eq('id', branchA).single()).data!.staff_group_id
    const attacker = groupId()
    for (let i = 0; i < 10; i++) {
      const { data } = await adminDb().rpc('bind_staff_group', { p_branch: branchA, p_code: `SIS-WRONG${i}`, p_group_id: attacker })
      expect(data).toBe(false)
    }
    const { data: late } = await adminDb().rpc('bind_staff_group', { p_branch: branchA, p_code: code, p_group_id: attacker })
    expect(late).toBe(false)
    const after = (await adminDb().from('branches').select('staff_group_id').eq('id', branchA).single()).data!.staff_group_id
    expect(after).toBe(before)
  })

  test('P3-A2-09 "ส่งข้อความทดสอบ" queues a test row delivered to the group; no group → NO_GROUP toast', async ({ page, context }) => {
    await pinBranchA(context)
    const { branchA } = fixtureIds()
    const { data: b } = await adminDb().from('branches').select('staff_group_id').eq('id', branchA).single()
    const group = b!.staff_group_id!
    expect(group).toMatch(/^C/)
    await page.goto('/settings/line')
    await expect(page.getByTestId('line-settings')).toHaveAttribute('data-hydrated', 'true')
    await page.getByTestId('line-test').click()
    await expect(page.getByText('ส่งข้อความทดสอบแล้ว', { exact: true })).toBeVisible()
    await expect.poll(() => mock.pushesTo(group).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)
    const push = mock.pushesTo(group)[0]
    expect((push.body!.messages as { altText: string }[])[0].altText).toContain('ข้อความทดสอบ')
    const { data: rows } = await adminDb().from('line_outbox').select('status').eq('branch_id', branchA).eq('kind', 'test').eq('target', group)
    expect((rows ?? []).map((r) => r.status)).toContain('sent')

    await adminDb().from('branches').update({ staff_group_id: null }).eq('id', branchA)
    await page.getByTestId('line-test').click()
    await expect(page.getByText('ยังไม่ได้ผูกกลุ่ม LINE ของพนักงาน', { exact: true })).toBeVisible()
  })
})
