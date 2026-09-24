import { join } from 'node:path'
import { expect, test, request as pwRequest, type Page } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { BRANCH_A_CODE } from './fixtures/users'
import { RUN, bottles, cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { deliver, type PushRow } from '../../src/lib/push/core'
import { NOTIFICATION_ROLES, kindsFor, type NotificationKind } from '../../src/lib/push/kinds'
import { addDays, businessNight } from '../../src/lib/date'

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
test.describe.configure({ mode: 'serial' })

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const LINE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.5.0'
const LINE_USER = `U${'b0e2'.repeat(8)}`

/** Only this spec's own install offers count — a real one from Chromium would race them. */
const ignoreRealInstallOffers = () =>
  window.addEventListener('beforeinstallprompt', (e) => (e.isTrusted ? e.stopImmediatePropagation() : undefined), true)

/** Opened from the home screen: `display-mode: standalone` matches. */
const installedApp = () => {
  const real = window.matchMedia.bind(window)
  window.matchMedia = (q: string) =>
    q.includes('display-mode: standalone') ? ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList) : real(q)
}

/** Headless Chromium has no push service: a fake subscription the browser reports as its own. */
async function fakeBrowserSubscription(page: Page, sub: { endpoint: string; p256dh: string; auth: string }, subscribed: boolean) {
  await page.addInitScript(
    ({ endpoint, p256dh, auth, subscribed: on }) => {
      let current: unknown = null
      const make = () => ({
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          current = null
          return true
        },
      })
      if (on) current = make()
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
    { ...sub, subscribed },
  )
}

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
  await adminDb().from('notifications').delete().like('payload->>name', `${RUN}%`)
  await adminDb().from('bookings').delete().like('name', `${RUN}%`)
  await adminDb().from('customers').delete().eq('line_user_id', LINE_USER)
  await cleanupRun()
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
    await fakeBrowserSubscription(page, { endpoint: FAKE_ENDPOINT, p256dh: FAKE_P256DH, auth: FAKE_AUTH }, false)
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

test.describe('staff · install and the icon count', () => {
  test.use({ storageState: as('staff') })

  test('P4-03-06 ติดตั้งแอป: the browser offer installs, home screen reads installed, iPhone gets the steps, LINE is sent out', async ({ page, browser }) => {
    await page.addInitScript(ignoreRealInstallOffers)
    await page.goto('/me')
    const card = page.getByTestId('install-card')
    // a desktop browser that has made no offer: the menu hint
    await expect(card).toHaveAttribute('data-view', 'browser')
    await expect(page.getByTestId('install-manual')).toBeVisible()

    // the browser offers an install: one button opens its own prompt
    await page.evaluate(() => {
      const w = window as unknown as { __prompted?: number }
      const offer = Object.assign(new Event('beforeinstallprompt'), {
        prompt: async () => {
          w.__prompted = (w.__prompted ?? 0) + 1
        },
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      })
      window.dispatchEvent(offer)
    })
    await expect(card).toHaveAttribute('data-view', 'offer')
    await page.getByTestId('install-button').click()
    await expect(card).toHaveAttribute('data-view', 'installed')
    await expect(page.getByTestId('install-done')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted)).toBe(1)

    // opened from the home screen
    const home = await browser.newContext({ storageState: as('staff') })
    await home.addInitScript(ignoreRealInstallOffers)
    await home.addInitScript(installedApp)
    const onHome = await home.newPage()
    await onHome.goto('/me')
    await expect(onHome.getByTestId('install-card')).toHaveAttribute('data-view', 'installed')
    await home.close()

    // iPhone Safari: the Add-to-Home-Screen steps; push waits for the installed app
    const iphone = await browser.newContext({ storageState: as('staff'), userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } })
    await iphone.addInitScript(ignoreRealInstallOffers)
    await iphone.addInitScript(() => {
      // Safari only gives PushManager to an app on the home screen
      delete (window as unknown as { PushManager?: unknown }).PushManager
    })
    const onIphone = await iphone.newPage()
    await onIphone.goto('/me')
    await expect(onIphone.getByTestId('install-card')).toHaveAttribute('data-view', 'ios')
    await expect(onIphone.getByTestId('install-ios').locator('li')).toHaveCount(3)
    await expect(onIphone.getByTestId('push-toggle')).toHaveAttribute('data-state', 'install-first')
    await expect(onIphone.getByTestId('push-install-first')).toBeVisible()
    await iphone.close()

    // LINE's in-app browser cannot install at all
    const inLine = await browser.newContext({ storageState: as('staff'), userAgent: LINE_UA })
    await inLine.addInitScript(ignoreRealInstallOffers)
    const onLine = await inLine.newPage()
    await onLine.goto('/me')
    await expect(onLine.getByTestId('install-card')).toHaveAttribute('data-view', 'in-app')
    await inLine.close()
  })

  test('P4-03-07 the icon shows own unread notifications, live, and clears with mark-all; unread_counts is service only', async ({ page }) => {
    const staffId = fixtureIds().users.staff
    const { error } = await adminDb()
      .from('notifications')
      .insert([1, 2].map((i) => ({ user_id: staffId, branch_id: fixtureIds().branchA, kind: 'deposit_requested', payload: { customer: `${RUN} icon ${i}` }, link: '/deposits' })))
    expect(error, error?.message).toBeNull()
    const unread = async () => (await adminDb().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', staffId).is('read_at', null)).count ?? 0

    // the service role reads the same number a push puts on the icon; a signed-in user may not
    const { data: counts, error: cErr } = await adminDb().rpc('unread_counts', { p_users: [staffId] })
    expect(cErr, cErr?.message).toBeNull()
    expect(counts).toEqual([{ user_id: staffId, unread: await unread() }])
    expect((await dbAs('staff').rpc('unread_counts', { p_users: [staffId] })).error).not.toBeNull()
    const sw = await (await page.request.get('/sw.js')).text()
    expect(sw).toContain('setAppBadge')

    await page.addInitScript(() => {
      const calls: (number | 'clear')[] = []
      ;(window as unknown as { __icon: typeof calls }).__icon = calls
      Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: async (n?: number) => void calls.push(n ?? 0) })
      Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: async () => void calls.push('clear') })
    })
    const icon = () => page.evaluate(() => (window as unknown as { __icon: (number | 'clear')[] }).__icon.at(-1) ?? null)
    await page.goto('/tonight')
    await expect.poll(icon).toBe(await unread())

    // live: one more lands while the page is open
    await adminDb().from('notifications').insert({ user_id: staffId, branch_id: fixtureIds().branchA, kind: 'deposit_requested', payload: { customer: `${RUN} icon 3` }, link: '/deposits' })
    await expect.poll(icon, { timeout: 15_000 }).toBe(await unread())

    await page.locator('[data-testid="bell-button"]:visible').click()
    await page.getByTestId('bell-mark-all').click()
    await expect.poll(icon).toBe('clear')
  })
})

test('P4-03-08 every kind reaches exactly its roles; a LINE booking confirmed on its own and a customer cancel in LINE tell bar and owner; a bar cancel tells no one', async () => {
  const { branchA, users } = fixtureIds()
  const admin = adminDb()
  const roleOf = new Map<string, string>()
  const recipients = async (kind: NotificationKind, key: 'deposit_id' | 'booking_id', id: string) => {
    const { data, error } = await admin.from('notifications').select('user_id').eq('kind', kind).eq(`payload->>${key}`, id)
    expect(error, error?.message).toBeNull()
    const ids = (data ?? []).map((r) => r.user_id)
    const unknown = ids.filter((u) => !roleOf.has(u))
    if (unknown.length) for (const p of (await admin.from('profiles').select('id, role').in('id', unknown)).data ?? []) roleOf.set(p.id, p.role)
    return ids
  }
  const expectRoles = async (kind: NotificationKind, key: 'deposit_id' | 'booking_id', id: string) => {
    const ids = await recipients(kind, key, id)
    const allowed = NOTIFICATION_ROLES[kind] as readonly string[]
    // other owners (every branch) may be told too — never a role outside the map
    expect([...new Set(ids.map((u) => roleOf.get(u)))].every((r) => allowed.includes(r!)), kind).toBe(true)
    for (const role of ['staff', 'bar', 'owner'] as const) {
      expect(ids.includes(users[role]), `${kind} → ${role}`).toBe(allowed.includes(role))
    }
  }

  // deposits: bottles in → bar / owner; a withdrawal request → the floor too
  const dep = await mustCreate('staff', { qty: 1 })
  await expectRoles('deposit_received', 'deposit_id', dep.id)
  await confirmAll(dep.id, [100])
  const [bottle] = await bottles(dep.id)
  const wd = await dbAs('bar').rpc('request_withdrawal', { p_deposit: dep.id, p_bottle_ids: [bottle.id], p_type: 'take_home' })
  expect(wd.error, wd.error?.message).toBeNull()
  await expectRoles('deposit_withdrawal_requested', 'deposit_id', dep.id)

  // bookings from LINE — confirmed on its own, then cancelled by the customer in LINE
  const { data: before } = await admin.from('booking_settings').select('line_enabled, auto_confirm, table_choice, closed_weekdays').eq('branch_id', branchA).single()
  await admin.from('booking_settings').update({ line_enabled: true, auto_confirm: true, table_choice: 'shop', closed_weekdays: [] }).eq('branch_id', branchA)
  try {
    const cust = await admin.from('customers').upsert({ line_user_id: LINE_USER, display_name: `${RUN} LINE`, locale: 'th' }, { onConflict: 'line_user_id' }).select('id').single()
    expect(cust.error, cust.error?.message).toBeNull()
    const book = async (days: number, tag: string) => {
      const { data, error } = await admin.rpc('create_booking', {
        p_branch: branchA, p_night: addDays(businessNight(), days), p_slot: '21:00:00', p_party: 2, p_name: `${RUN} ${tag}`, p_customer_id: cust.data!.id,
      } as never)
      expect(error, error?.message).toBeNull()
      return (data as { id: string }).id
    }
    const auto = await book(6, 'auto')
    await expectRoles('booking_new', 'booking_id', auto)
    const byCustomer = await admin.rpc('cancel_booking', { p_booking: auto, p_customer_id: cust.data!.id, p_branch: branchA } as never)
    expect(byCustomer.error, byCustomer.error?.message).toBeNull()
    await expectRoles('booking_cancelled', 'booking_id', auto)

    const other = await book(7, 'bar-cancel')
    const byBar = await dbAs('bar').rpc('cancel_booking', { p_booking: other, p_reason: `${RUN} bar` } as never)
    expect(byBar.error, byBar.error?.message).toBeNull()
    expect(await recipients('booking_cancelled', 'booking_id', other)).toEqual([])
  } finally {
    await admin
      .from('booking_settings')
      .update({ line_enabled: before?.line_enabled ?? true, auto_confirm: before?.auto_confirm ?? false, table_choice: before?.table_choice ?? 'shop', closed_weekdays: before?.closed_weekdays ?? [] })
      .eq('branch_id', branchA)
  }
})

for (const role of ['staff', 'bar', 'owner'] as const) {
  test.describe(`${role} · /me`, () => {
    test.use({ storageState: as(role) })
    test(`P4-03-09 ${role}: the notification card lists what this role is told about`, async ({ page }) => {
      await page.goto('/me')
      const box = page.getByTestId('push-kinds')
      await expect(box.locator('[data-kind]')).toHaveCount(kindsFor(role).length)
      expect(await box.locator('[data-kind]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(kindsFor(role))
      await expect(box).toContainText(role === 'owner' ? 'ทุกสาขา' : 'เฉพาะสาขาของคุณ')
      await expect(box).toContainText('ตัวเลขบนไอคอนแอป')
    })
  })
}

test.describe('staff · the bell in the installed app', () => {
  test.use({ storageState: as('staff') })

  test('P4-03-11 notifications off → เปิดการแจ้งเตือน beside อ่านทั้งหมดแล้ว; blocked → where to allow; a browser tab → no button', async ({ page, browser }) => {
    const staffId = fixtureIds().users.staff
    const bell = (p: Page) => p.locator('[data-testid="bell-button"]:visible').click()
    // one unread, so อ่านทั้งหมดแล้ว is there as well
    const { error } = await adminDb().from('notifications').insert({ user_id: staffId, branch_id: fixtureIds().branchA, kind: 'deposit_requested', payload: { customer: `${RUN} bell push` }, link: '/deposits' })
    expect(error, error?.message).toBeNull()

    const endpoint = `${FAKE_ENDPOINT}/bell`
    await page.addInitScript(installedApp)
    await fakeBrowserSubscription(page, { endpoint, p256dh: FAKE_P256DH, auth: FAKE_AUTH }, false)
    await page.goto('/tonight')
    await bell(page)
    const enable = page.getByTestId('bell-push-enable')
    const markAll = page.getByTestId('bell-mark-all')
    await expect(enable).toBeVisible()
    await expect(markAll).toBeVisible()
    const [a, b] = [await enable.boundingBox(), await markAll.boundingBox()]
    expect(Math.abs(a!.y - b!.y), 'side by side').toBeLessThan(4)
    await enable.click()
    await expect(enable).toHaveCount(0)
    expect((await adminDb().from('push_subscriptions').select('user_id').eq('endpoint', endpoint)).data).toEqual([{ user_id: staffId }])
    await adminDb().from('push_subscriptions').delete().eq('endpoint', endpoint)

    // blocked in the phone's settings: a note, no button that cannot work
    const blocked = await browser.newContext({ storageState: as('staff') })
    await blocked.addInitScript(installedApp)
    await blocked.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied' }))
    const onBlocked = await blocked.newPage()
    await onBlocked.goto('/tonight')
    await bell(onBlocked)
    await expect(onBlocked.getByTestId('bell-push-blocked')).toBeVisible()
    await expect(onBlocked.getByTestId('bell-push-enable')).toHaveCount(0)
    await blocked.close()

    // a browser tab, not the installed app: /me is the place for it
    const tab = await browser.newContext({ storageState: as('staff') })
    const inTab = await tab.newPage()
    await inTab.goto('/tonight')
    await bell(inTab)
    await expect(inTab.getByTestId('bell-mark-all')).toBeVisible()
    await expect(inTab.getByTestId('bell-push-enable')).toHaveCount(0)
    await tab.close()
  })
})

test.describe('staff · test push', () => {
  test.use({ storageState: as('staff') })
  test('P4-03-09 ส่งแจ้งเตือนทดสอบ with no device registered says so', async ({ page, context }) => {
    const staffId = fixtureIds().users.staff
    expect((await adminDb().from('push_subscriptions').select('id').eq('user_id', staffId)).data).toEqual([])
    await context.grantPermissions(['notifications'])
    // the browser holds a subscription the server does not know (pruned, or saved under someone else)
    await fakeBrowserSubscription(page, { endpoint: `${FAKE_ENDPOINT}/stale`, p256dh: FAKE_P256DH, auth: FAKE_AUTH }, true)
    await page.goto('/me')
    await expect(page.getByTestId('push-toggle')).toHaveAttribute('data-state', 'on', { timeout: 15_000 })
    await page.getByTestId('push-test').click()
    await expect(page.getByText('ยังไม่มีเครื่องที่เปิดแจ้งเตือนไว้')).toBeVisible()
    const { count } = await adminDb().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', staffId).eq('kind', 'test')
    expect(count).toBe(0)
  })
})
