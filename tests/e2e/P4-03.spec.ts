import { join } from 'node:path'
import { expect, test, request as pwRequest } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { BRANCH_A_CODE } from './fixtures/users'
import { RUN } from './fixtures/deposits'
import { deliver, type PushRow } from '../../src/lib/push/core'

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
test.describe.configure({ mode: 'serial' })

// an FCM-shaped endpoint (the save action only accepts real push-service hosts); nothing is
// ever sent to it — P4-03-04 drives deliver() with a recording sender
const FAKE_PREFIX = 'https://fcm.googleapis.com/fcm/send/sis-e2e-'
const FAKE_ENDPOINT = `${FAKE_PREFIX}${RUN}`
// valid-looking base64url keys (65-byte P-256 point, 16-byte auth secret)
const FAKE_P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const FAKE_AUTH = 'tBHItJI5svbpez7KI4CCXg'

test.afterAll(async () => {
  await adminDb().from('push_subscriptions').delete().like('endpoint', `${FAKE_PREFIX}${RUN}%`)
  await adminDb().from('notifications').delete().like('payload->>customer', `${RUN}%`)
})

test('P4-03-01 manifest: name, start_url, icons, theme colour from tokens', async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const res = await ctx.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)
  const m = await res.json()
  expect(m).toMatchObject({ name: 'SIS Manager', start_url: '/', display: 'standalone', theme_color: '#221619', background_color: '#F6F4F3' })
  const sizes = (m.icons as { sizes: string }[]).map((i) => i.sizes)
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
  for (const icon of m.icons as { src: string }[]) expect((await ctx.get(icon.src)).status()).toBe(200)
  await ctx.dispose()
})

test.describe('staff', () => {
  test.use({ storageState: as('staff') })

  test('P4-03-02 the service worker registers on staff pages, has no fetch cache, and not on /liff', async ({ page, browser }) => {
    await page.goto('/tonight')
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? null), { timeout: 15_000 })
      .toBe(`${BASE_URL}/`)
    const sw = await page.request.get('/sw.js')
    expect(sw.headers()['content-type']).toContain('javascript')
    const body = await sw.text()
    expect(body).toContain("addEventListener('push'")
    expect(body).not.toMatch(/addEventListener\(\s*['"]fetch['"]/)
    expect(body).not.toContain('caches.')

    const fresh = await browser.newContext()
    const liff = await fresh.newPage()
    await liff.goto(`/liff/${BRANCH_A_CODE.toLowerCase()}`)
    await liff.waitForTimeout(2_000)
    expect(await liff.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
    await fresh.close()
  })

  test('P4-03-03 enable stores the own subscription row, disable removes it', async ({ page, context }) => {
    await context.grantPermissions(['notifications'])
    // Headless Chromium has no real push service — swap in a well-formed fake subscription.
    await page.addInitScript(
      ({ endpoint, p256dh, auth }) => {
        let current: unknown = null
        const make = () => ({
          endpoint,
          toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
          unsubscribe: async () => {
            current = null
            return true
          },
        })
        // headless Chromium reports 'denied' even after grantPermissions
        Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
        Notification.requestPermission = async () => 'granted'
        PushManager.prototype.getSubscription = async function () {
          return current as PushSubscription | null
        }
        PushManager.prototype.subscribe = async function () {
          current = make()
          return current as PushSubscription
        }
      },
      { endpoint: FAKE_ENDPOINT, p256dh: FAKE_P256DH, auth: FAKE_AUTH },
    )
    await page.goto('/me')
    const toggle = page.getByTestId('push-toggle')
    await expect(toggle).toHaveAttribute('data-state', 'off', { timeout: 15_000 })
    await page.getByTestId('push-enable').click()
    await expect(toggle).toHaveAttribute('data-state', 'on')
    const staffId = fixtureIds().users.staff
    const { data: rows } = await adminDb().from('push_subscriptions').select('user_id, p256dh, auth').eq('endpoint', FAKE_ENDPOINT)
    expect(rows).toEqual([{ user_id: staffId, p256dh: FAKE_P256DH, auth: FAKE_AUTH }])

    await page.getByTestId('push-disable').click()
    await expect(toggle).toHaveAttribute('data-state', 'off')
    const { data: after } = await adminDb().from('push_subscriptions').select('id').eq('endpoint', FAKE_ENDPOINT)
    expect(after).toEqual([])
  })
})

test('P4-03-04 claim_push hands out each notification once; 410 prunes the subscription; cron route needs the secret', async () => {
  const barId = fixtureIds().users.bar
  const live = `${FAKE_ENDPOINT}/live`
  const gone = `${FAKE_ENDPOINT}/gone`
  const { error: subErr } = await adminDb()
    .from('push_subscriptions')
    .insert([
      { user_id: barId, endpoint: live, p256dh: FAKE_P256DH, auth: FAKE_AUTH },
      { user_id: barId, endpoint: gone, p256dh: FAKE_P256DH, auth: FAKE_AUTH },
    ])
  expect(subErr, subErr?.message).toBeNull()
  const { data: n, error: nErr } = await adminDb()
    .from('notifications')
    .insert({ user_id: barId, branch_id: fixtureIds().branchA, kind: 'deposit_requested', payload: { customer: `${RUN} push` }, link: '/deposits' })
    .select('id')
    .single()
  expect(nErr, nErr?.message).toBeNull()

  // other runs leave unpushed notifications behind; claims go oldest first, so drain
  // batches until ours comes out (each claim marks its whole batch)
  let mine: PushRow[] = []
  for (let i = 0; i < 20 && !mine.length; i++) {
    const { data: claimed, error } = await adminDb().rpc('claim_push', { p_limit: 200 })
    expect(error, error?.message).toBeNull()
    mine = (claimed as PushRow[]).filter((r) => r.notification_id === n!.id)
  }
  expect(mine.map((r) => r.endpoint).sort()).toEqual([gone, live].sort())

  const sent: string[] = []
  const result = await deliver(
    mine,
    (row) => ({ title: 'การแจ้งเตือน', body: String(row.payload?.customer ?? ''), url: row.link ?? '/', tag: row.notification_id }),
    async (sub, message) => {
      if (sub.endpoint === gone) throw Object.assign(new Error('gone'), { statusCode: 410 })
      sent.push(`${sub.endpoint}|${message.url}`)
      return { statusCode: 201 }
    },
    async (id) => {
      await adminDb().from('push_subscriptions').delete().eq('id', id)
    },
  )
  expect(result).toEqual({ sent: 1, removed: 1, failed: 0 })
  expect(sent).toEqual([`${live}|/deposits`])
  const { data: left } = await adminDb().from('push_subscriptions').select('endpoint').in('endpoint', [live, gone])
  expect(left).toEqual([{ endpoint: live }])

  // claimed once: a second claim does not hand the same notification out again
  const { data: again } = await adminDb().rpc('claim_push', { p_limit: 200 })
  expect((again as PushRow[]).some((r) => r.notification_id === n!.id)).toBe(false)

  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  expect((await ctx.post('/api/cron/push-dispatch')).status()).toBe(401)
  expect((await ctx.post('/api/cron/push-dispatch', { headers: { authorization: 'Bearer wrong-secret-wrong-secret' } })).status()).toBe(401)
  await ctx.dispose()
})
