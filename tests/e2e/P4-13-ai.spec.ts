import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { bottleIds, requestWithdrawal } from './fixtures/p2a-flows'
import { MockAnthropic } from './fixtures/ai-mock'
import { addDays, businessNight } from '../../src/lib/date'

// R-070 / R-071: the assistant — who gets it, the owner's settings, page-aware chips, the chat
// endpoint's gates, and the confirmation cards. Anthropic is the local mock (fixtures/ai-mock.ts):
// a key with "reject" in it is refused like a bad key; "TOOL <name> <json>" makes the mock call a tool.
test.describe.configure({ mode: 'serial' })
const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const FAKE_KEY = `sk-ant-api03-reject${'x'.repeat(40)}`
const GOOD_KEY = `sk-ant-api03-e2eok${'x'.repeat(40)}`
const mock = new MockAnthropic()

let saved: { settings: { enabled_roles: ('staff' | 'bar' | 'owner')[]; model: string } | null; key: string | null } = { settings: null, key: null }

async function setAi(opts: { roles?: ('staff' | 'bar' | 'owner')[]; key?: string | null; model?: string }) {
  const db = adminDb()
  if (opts.roles || opts.model) {
    await db.from('ai_settings').update({ ...(opts.roles ? { enabled_roles: opts.roles } : {}), ...(opts.model ? { model: opts.model } : {}) }).eq('id', true)
  }
  if (opts.key === null) await db.from('ai_secrets').delete().eq('id', true)
  else if (opts.key) await db.from('ai_secrets').upsert({ id: true, api_key: opts.key })
}

test.beforeAll(async () => {
  await mock.start()
  const db = adminDb()
  const [{ data: s }, { data: k }] = await Promise.all([
    db.from('ai_settings').select('enabled_roles, model').eq('id', true).maybeSingle(),
    db.from('ai_secrets').select('api_key').eq('id', true).maybeSingle(),
  ])
  saved = { settings: s, key: k?.api_key ?? null }
})

test.afterAll(async () => {
  await mock.stop()
  // put back exactly what the shop had
  const db = adminDb()
  if (saved.settings) await db.from('ai_settings').update(saved.settings).eq('id', true)
  if (saved.key) await db.from('ai_secrets').upsert({ id: true, api_key: saved.key })
  else await db.from('ai_secrets').delete().eq('id', true)
  await db.from('ai_usage').delete().in('user_id', Object.values(fixtureIds().users))
  await db.from('bookings').delete().like('name', 'E2E-AI%')
  await cleanupRun()
})

test.describe('staff', () => {
  test.use({ storageState: as('staff') })

  test('P4-13-01 the button shows only with a key and the role turned on; the chat endpoint says why not', async ({ page, request }) => {
    await setAi({ roles: ['staff', 'bar', 'owner'], key: null })
    await page.goto('/tonight')
    await expect(page.getByTestId('top-bar')).toBeVisible()
    await expect(page.getByTestId('ai-open')).toHaveCount(0)
    const noKey = await page.request.post(`${BASE_URL}/api/ai/chat`, { data: { messages: [{ role: 'user', text: 'สวัสดี' }], path: '/tonight' } })
    expect(noKey.status()).toBe(409)
    expect((await noKey.json()).error).toBe('ai_not_configured')

    await setAi({ key: FAKE_KEY, roles: ['bar', 'owner'] })
    await page.reload()
    await expect(page.getByTestId('top-bar')).toBeVisible()
    await expect(page.getByTestId('ai-open')).toHaveCount(0)
    const off = await page.request.post(`${BASE_URL}/api/ai/chat`, { data: { messages: [{ role: 'user', text: 'สวัสดี' }], path: '/tonight' } })
    expect(off.status()).toBe(403)

    await setAi({ roles: ['staff', 'bar', 'owner'] })
    await page.reload()
    await expect(page.getByTestId('ai-open')).toBeVisible()
    // signed out: nothing
    const anon = await request.post(`${BASE_URL}/api/ai/chat`, { data: { messages: [{ role: 'user', text: 'x' }] }, headers: { cookie: '' } })
    expect([401, 403]).toContain(anon.status())
  })

  test('P4-13-02 the panel: page chips, a question goes out, a rejected key shows the owner-facing error', async ({ page }) => {
    await setAi({ roles: ['staff', 'bar', 'owner'], key: FAKE_KEY, model: 'claude-opus-5' })
    await page.goto('/bookings')
    await page.getByTestId('ai-open').click()
    const panel = page.getByTestId('ai-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('ai-chip').first()).toBeVisible()
    await expect(panel.locator('[data-testid="ai-chip"][data-key="tonightBookings"]')).toContainText('ดูรายการจองคืนนี้')
    await panel.locator('[data-testid="ai-chip"][data-key="doBook"]').click()
    await expect(panel.getByTestId('ai-user')).toHaveText('รับจองโต๊ะให้ลูกค้า')
    await expect(panel.getByTestId('ai-error')).toHaveAttribute('data-error', 'ai_key_rejected', { timeout: 30_000 })
    await expect(panel.getByTestId('ai-error')).toContainText('API key ใช้ไม่ได้')
    // one usage row for the attempt
    const { users } = fixtureIds()
    const { count } = await adminDb().from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', users.staff)
    expect(count).toBeGreaterThanOrEqual(1)
    // the chat survives closing the panel (this tab), and เริ่มคุยใหม่ clears it
    await page.keyboard.press('Escape')
    await page.getByTestId('ai-open').click()
    await expect(page.getByTestId('ai-user')).toHaveCount(1)
    await page.getByTestId('ai-reset').click()
    await expect(page.getByTestId('ai-user')).toHaveCount(0)
  })
})

test.describe('bar', () => {
  test.use({ storageState: as('bar') })

  test('P4-13-03 chips follow the record on screen: a deposit with a waiting withdrawal asks what to do next', async ({ page }) => {
    await setAi({ roles: ['staff', 'bar', 'owner'], key: FAKE_KEY })
    const dep = await mustCreate('staff', { qty: 2 })
    await confirmAll(dep.id, [100, 100])
    const ids = await bottleIds(dep.id)
    await requestWithdrawal(dep.id, [ids[0]], 'take_home')
    const res = await page.request.get(`${BASE_URL}/api/ai/chips?path=${encodeURIComponent(`/deposits/${dep.id}`)}`)
    expect(res.status()).toBe(200)
    const { chips } = (await res.json()) as { chips: { key: string; values?: { code?: string } }[] }
    expect(chips[0]).toMatchObject({ key: 'doCompleteWithdrawal', values: { code: dep.code } })
    expect(chips.map((c) => c.key)).toContain('howExtend')
    expect(chips.length).toBeLessThanOrEqual(4)

    await page.goto(`/deposits/${dep.id}`)
    await page.getByTestId('ai-open').click()
    await expect(page.locator('[data-testid="ai-chip"][data-key="doCompleteWithdrawal"]')).toContainText(`ยืนยันการเบิกของ ${dep.code}`)
  })
})

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P4-13-04 /settings/ai: role switches, key format, key hint, model name, test against Anthropic', async ({ page, context }) => {
    await context.addCookies([{ name: 'sis_branch', value: fixtureIds().branchA, url: BASE_URL }])
    await setAi({ roles: ['staff', 'bar', 'owner'], key: null, model: 'claude-opus-5' })
    await page.goto('/settings/ai')
    await expect(page.getByTestId('ai-status')).toHaveAttribute('data-ready', 'false')
    await expect(page.getByTestId('ai-key-state')).toContainText('ยังไม่ได้ตั้ง')

    // a switch saves at once
    await page.getByTestId('ai-role-staff').click()
    await expect(page.getByTestId('ai-role-staff')).toHaveAttribute('data-on', 'false')
    const { data: s1 } = await adminDb().from('ai_settings').select('enabled_roles').eq('id', true).single()
    expect(s1!.enabled_roles).toEqual(['bar', 'owner'])
    await page.getByTestId('ai-role-staff').click()
    await expect(page.getByTestId('ai-role-staff')).toHaveAttribute('data-on', 'true')

    // not an Anthropic key → refused on the page, nothing stored
    await page.getByTestId('ai-key-input').fill('not-a-key-but-long-enough-000000')
    await page.getByTestId('ai-key-save').click()
    await expect(page.getByText('รูปแบบ key ไม่ถูกต้อง')).toBeVisible()
    const { data: none } = await adminDb().from('ai_secrets').select('id').eq('id', true).maybeSingle()
    expect(none).toBeNull()

    await page.getByTestId('ai-key-input').fill(FAKE_KEY)
    await page.getByTestId('ai-key-save').click()
    await expect(page.getByTestId('ai-key-state')).toContainText(`sk-ant-…${FAKE_KEY.slice(-4)}`)
    await expect(page.getByTestId('ai-key-input')).toHaveValue('')
    await expect(page.getByTestId('ai-status')).toHaveAttribute('data-ready', 'true')

    await page.getByTestId('ai-model-input').fill('claude-sonnet-5')
    await page.getByTestId('ai-model-save').click()
    await expect(page.getByText('ใช้โมเดล claude-sonnet-5 แล้ว')).toBeVisible()
    await page.getByTestId('ai-model-input').fill('bad model!')
    await page.getByTestId('ai-model-save').click()
    await expect(page.getByText('ชื่อโมเดลไม่ถูกต้อง')).toBeVisible()

    await page.getByTestId('ai-test').click()
    await expect(page.getByText('Anthropic ไม่รับ key นี้')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('ai-key-input').fill(GOOD_KEY)
    await page.getByTestId('ai-key-save').click()
    await expect(page.getByTestId('ai-key-state')).toContainText(GOOD_KEY.slice(-4))
    await page.getByTestId('ai-test').click()
    await expect(page.getByText('เชื่อมต่อได้ · Mock claude-sonnet-5')).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('ai-key-remove').click()
    await expect(page.getByTestId('ai-key-state')).toContainText('ยังไม่ได้ตั้ง')
  })

  test('P4-13-05 the key never reaches a browser: authenticated users read no ai_secrets row; only the owner writes ai_settings', async () => {
    await setAi({ key: FAKE_KEY })
    const { dbAs } = await import('./fixtures/db')
    for (const role of ['staff', 'bar', 'owner'] as const) {
      const { data } = await dbAs(role).from('ai_secrets').select('api_key')
      expect(data ?? []).toEqual([])
    }
    const { data: upd } = await dbAs('bar').from('ai_settings').update({ model: 'claude-haiku-4-5' }).eq('id', true).select('id')
    expect(upd ?? []).toEqual([])
    const { error: rpcErr } = await dbAs('staff').rpc('ai_usage_month')
    expect(rpcErr?.message).toContain('FORBIDDEN')
  })
})

// ── phase 2: cards (R-071) ────────────────────────────────────────────────

async function ask(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('ai-input').fill(text)
  await page.getByTestId('ai-send').click()
}

test.describe('cards as staff', () => {
  test.use({ storageState: as('staff') })

  test('P4-13-06 a withdrawal prepared in the chat happens only on ยืนยัน, with the page context sent along', async ({ page }) => {
    await setAi({ roles: ['staff', 'bar', 'owner'], key: GOOD_KEY, model: 'claude-opus-5' })
    const dep = await mustCreate('staff', { qty: 2 })
    await confirmAll(dep.id, [100, 60])
    await page.goto(`/deposits/${dep.id}`)
    await page.getByTestId('ai-open').click()
    await ask(page, `TOOL propose_withdrawal {"code":"${dep.code}","bottles":[2],"type":"take_home"}`)
    const card = page.getByTestId('ai-card')
    await expect(card).toHaveAttribute('data-kind', 'withdraw')
    await expect(card).toContainText('สร้างคำขอเบิก')
    await expect(card).toContainText(dep.code)
    await expect(card).toContainText('2 (60%)')
    await expect(card).toContainText('กลับบ้าน')
    await expect(page.getByTestId('ai-answer').first()).toContainText('MOCK: เตรียมการ์ดให้แล้ว')
    // nothing yet
    const { count: before } = await adminDb().from('withdrawals').select('id', { count: 'exact', head: true }).eq('deposit_id', dep.id)
    expect(before).toBe(0)
    // the model was told a card is waiting, and got the page it was asked on
    expect(mock.toolResults().at(-1)).toContain('Nothing has happened yet')
    const first = mock.requests.find((r) => JSON.stringify(r.body.messages ?? []).includes(dep.code))
    expect(JSON.stringify(first?.body.messages)).toContain(`page: /deposits/${dep.id}`)
    // staff get no bar-only tools
    const names = (first?.body.tools ?? []).map((t) => t.name)
    expect(names).toContain('propose_withdrawal')
    expect(names).not.toContain('propose_extend')

    await card.getByTestId('ai-card-confirm').click()
    await expect(card).toHaveAttribute('data-state', 'done')
    await expect(card.getByTestId('ai-card-result')).toContainText('เรียบร้อยแล้ว')
    const { data: w } = await adminDb().from('withdrawals').select('type, status, bottle:deposit_bottles(bottle_no)').eq('deposit_id', dep.id)
    expect(w).toEqual([{ type: 'take_home', status: 'pending', bottle: { bottle_no: 2 } }])

    // the next question tells the model what became of the card
    await ask(page, 'แล้วขวดไหนยังเหลือ')
    await expect(page.getByTestId('ai-answer').nth(1)).toContainText('MOCK:')
    expect(JSON.stringify(mock.requests.at(-1)?.body.messages)).toContain(`[card withdraw ${dep.code}: done]`)
  })

  test('P4-13-07 no card when the tool is not for this role or the details are missing — the model is told why', async ({ page }) => {
    await setAi({ roles: ['staff', 'bar', 'owner'], key: GOOD_KEY })
    const dep = await mustCreate('staff', { qty: 2 })
    await confirmAll(dep.id, [100, 100])
    await page.goto('/deposits')
    await page.getByTestId('ai-open').click()
    await ask(page, `TOOL propose_extend {"code":"${dep.code}","days":30}`)
    await expect(page.getByTestId('ai-answer').last()).toContainText('MOCK:')
    await expect(page.getByTestId('ai-card')).toHaveCount(0)
    expect(mock.toolResults().at(-1)).toContain('only bar or owner')

    await ask(page, `TOOL propose_withdrawal {"code":"${dep.code}","type":"in_store"}`)
    await expect(page.getByTestId('ai-answer')).toHaveCount(2)
    await expect(page.getByTestId('ai-answer').last()).toContainText('MOCK:')
    await expect(page.getByTestId('ai-card')).toHaveCount(0)
    expect(mock.toolResults().at(-1)).toContain('ask which bottles')
  })

  test('P4-13-08 a new deposit opens the form filled in; the person adds the photo there', async ({ page }) => {
    await setAi({ roles: ['staff', 'bar', 'owner'], key: GOOD_KEY })
    await page.goto('/tonight')
    await page.getByTestId('ai-open').click()
    await ask(page, 'TOOL propose_deposit_form {"customer":"E2E-AI คุณบี","phone":"0812345678","table":"A2","items":[{"name":"Black Label","bottles":2},{"name":"Hennessy","bottles":1}]}')
    const card = page.getByTestId('ai-card')
    await expect(card).toHaveAttribute('data-kind', 'depositForm')
    await expect(card).toContainText('Black Label × 2 · Hennessy × 1')
    await card.getByTestId('ai-card-confirm').click()
    await page.waitForURL(/\/deposits\/new\?/)
    await expect(page.getByTestId('new-deposit-form')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('deposit-name')).toHaveValue('E2E-AI คุณบี')
    await expect(page.getByTestId('deposit-phone')).toHaveValue('0812345678')
    await expect(page.getByTestId('deposit-item')).toHaveValue('Black Label')
    await expect(page.getByTestId('deposit-quantity')).toHaveValue('2')
    await expect(page.getByTestId('deposit-item-1')).toHaveValue('Hennessy')
    await expect(page.getByTestId('deposit-table')).toHaveValue('A2')
  })
})

test.describe('cards as bar', () => {
  test.use({ storageState: as('bar') })

  test('P4-13-09 a booking: ยกเลิก leaves nothing; ยืนยัน makes it, with its code on the card', async ({ page }) => {
    await setAi({ roles: ['staff', 'bar', 'owner'], key: GOOD_KEY })
    const night = addDays(businessNight(), 3)
    await page.goto('/bookings')
    await page.getByTestId('ai-open').click()
    const tool = `TOOL propose_booking {"night":"${night}","time":"21:00","party":4,"name":"E2E-AI คุณเอ","phone":"0899999999"}`
    await ask(page, tool)
    const card = page.getByTestId('ai-card').last()
    await expect(card).toHaveAttribute('data-kind', 'book')
    await card.getByTestId('ai-card-cancel').click()
    await expect(card).toHaveAttribute('data-state', 'cancelled')
    const { count: none } = await adminDb().from('bookings').select('id', { count: 'exact', head: true }).eq('name', 'E2E-AI คุณเอ')
    expect(none).toBe(0)

    await ask(page, tool)
    await expect(page.getByTestId('ai-card')).toHaveCount(2)
    const again = page.getByTestId('ai-card').last()
    await again.getByTestId('ai-card-confirm').click()
    await expect(again).toHaveAttribute('data-state', 'done')
    const { data: b } = await adminDb().from('bookings').select('code, status, party_size, night').eq('name', 'E2E-AI คุณเอ').single()
    expect(b).toMatchObject({ status: 'confirmed', party_size: 4, night })
    await expect(again.getByTestId('ai-card-result')).toContainText(b!.code)
  })

  test('P4-13-10 bar confirms a waiting withdrawal from a card', async ({ page }) => {
    await setAi({ roles: ['staff', 'bar', 'owner'], key: GOOD_KEY })
    const dep = await mustCreate('staff', { qty: 1 })
    await confirmAll(dep.id, [100])
    await requestWithdrawal(dep.id, await bottleIds(dep.id), 'in_store')
    await page.goto(`/deposits/${dep.id}`)
    await page.getByTestId('ai-open').click()
    await ask(page, `TOOL propose_complete_withdrawal {"code":"${dep.code}"}`)
    const card = page.getByTestId('ai-card').last()
    await expect(card).toHaveAttribute('data-kind', 'completeWithdrawal')
    await card.getByTestId('ai-card-confirm').click()
    await expect(card).toHaveAttribute('data-state', 'done')
    const { data } = await adminDb().from('deposits').select('status').eq('id', dep.id).single()
    expect(data!.status).toBe('withdrawn')
  })
})
