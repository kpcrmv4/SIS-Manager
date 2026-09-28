import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { bottleIds, requestWithdrawal } from './fixtures/p2a-flows'

// R-070: the assistant's plumbing — who gets it, the owner's settings, page-aware chips, and the
// chat endpoint's gates. No real key here, so a live answer is not part of the suite; a well-formed
// fake key proves the request reaches Anthropic and a rejected key comes back as ai_key_rejected.
test.describe.configure({ mode: 'serial' })
const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const FAKE_KEY = `sk-ant-api03-e2e${'x'.repeat(40)}`

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
  const db = adminDb()
  const [{ data: s }, { data: k }] = await Promise.all([
    db.from('ai_settings').select('enabled_roles, model').eq('id', true).maybeSingle(),
    db.from('ai_secrets').select('api_key').eq('id', true).maybeSingle(),
  ])
  saved = { settings: s, key: k?.api_key ?? null }
})

test.afterAll(async () => {
  // put back exactly what the shop had
  const db = adminDb()
  if (saved.settings) await db.from('ai_settings').update(saved.settings).eq('id', true)
  if (saved.key) await db.from('ai_secrets').upsert({ id: true, api_key: saved.key })
  else await db.from('ai_secrets').delete().eq('id', true)
  await db.from('ai_usage').delete().in('user_id', Object.values(fixtureIds().users))
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
    await panel.locator('[data-testid="ai-chip"][data-key="howBook"]').click()
    await expect(panel.getByTestId('ai-user')).toHaveText('รับจองแทนลูกค้าทำยังไง')
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
    expect(chips[0]).toMatchObject({ key: 'nextWithdrawal', values: { code: dep.code } })
    expect(chips.map((c) => c.key)).toContain('howExtend')
    expect(chips.length).toBeLessThanOrEqual(4)

    await page.goto(`/deposits/${dep.id}`)
    await page.getByTestId('ai-open').click()
    await expect(page.locator('[data-testid="ai-chip"][data-key="nextWithdrawal"]')).toContainText(`คำขอเบิก ${dep.code} ต้องทำอะไรต่อ`)
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
