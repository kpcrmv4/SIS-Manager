import { expect, test } from '@playwright/test'
import { adminDb, anonDb, credsFor } from './fixtures/db'

const ANON = { cookies: [], origins: [] }

test.describe('anonymous', () => {
  test.use({ storageState: ANON })

  test('P0-AUTH-01 signUp with the publishable key is refused', async () => {
    const { data, error } = await anonDb().auth.signUp({ email: `probe.${Date.now()}@example.com`, password: 'Probe-12345678' })
    expect(data.user).toBeNull()
    expect(error?.code ?? error?.message).toMatch(/signup_disabled|Signups not allowed/i)
  })

  test('P0-AUTH-10 unauthenticated page redirects to login with next', async ({ request }) => {
    const res = await request.get('/tonight', { maxRedirects: 0 })
    expect(res.status()).toBe(307)
    expect(res.headers()['location']).toMatch(/\/login\?next=%2Ftonight$/)
  })

  test('P0-AUTH-11 /api/* is never redirected to the HTML login page', async ({ request }) => {
    const logout = await request.post('/api/auth/logout', { maxRedirects: 0 })
    expect(logout.status()).toBe(200)
    const pw = await request.post('/api/auth/password', { data: {}, maxRedirects: 0 })
    expect(pw.status()).toBe(401)
    expect(await pw.json()).toEqual({ error: 'unauthenticated' })
  })

  test('P0-AUTH-12 /liff/* is not gated by staff auth', async ({ request }) => {
    const res = await request.get('/liff/zta', { maxRedirects: 0 })
    expect(res.status()).not.toBe(307)
    expect(res.headers()['location'] ?? '').not.toContain('/login')
  })

  test('P0-AUTH-15 sw.js and manifest are outside the gate', async ({ request }) => {
    for (const path of ['/sw.js', '/manifest.webmanifest']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect([200, 404]).toContain(res.status())
    }
  })

  test('P0-AUTH-08 wrong password shows the error and stays on /login', async ({ page }) => {
    const c = credsFor('staff')
    await page.goto('/login')
    await page.getByLabel('ชื่อผู้ใช้หรืออีเมล', { exact: true }).fill(c.username)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill('wrong-password-1')
    const resp = page.waitForResponse('**/api/auth/login')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    expect((await resp).status()).toBe(401)
    // Next's route announcer is also role=alert — address the form's own alert
    await expect(page.locator('form p[role="alert"]')).toHaveText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeEnabled()
  })

  test('P0-AUTH-09 inactive profile is refused and gets no session', async ({ page, context }) => {
    const c = credsFor('inactive')
    await page.goto('/login')
    await page.getByLabel('ชื่อผู้ใช้หรืออีเมล', { exact: true }).fill(c.username)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(c.password)
    const resp = page.waitForResponse('**/api/auth/login')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    const r = await resp
    expect(r.status()).toBe(403)
    expect(await r.json()).toEqual({ error: 'inactive' })
    await expect(page.locator('form p[role="alert"]')).toHaveText('บัญชีนี้ถูกปิดการใช้งาน ติดต่อเจ้าของร้าน')
    expect((await context.cookies()).filter((ck) => ck.name.startsWith('sb-'))).toHaveLength(0)
  })

  test('P0-AUTH-06 username login lands staff on /tonight', async ({ page }) => {
    const c = credsFor('staff')
    await page.goto('/login')
    await page.getByLabel('ชื่อผู้ใช้หรืออีเมล', { exact: true }).fill(c.username)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(c.password)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await expect(page).toHaveURL(/\/tonight$/)
  })

  test('P0-AUTH-07 e-mail login lands owner on /overview', async ({ page }) => {
    const c = credsFor('owner')
    await page.goto('/login')
    await page.getByLabel('ชื่อผู้ใช้หรืออีเมล', { exact: true }).fill(c.email)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(c.password)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await expect(page).toHaveURL(/\/overview$/)
  })

  // '/\t/…' is a real TAB: the URL parser strips it and reads '//evil.example'
  for (const evil of ['//evil.example/x', '/\t/evil.example', '/\\evil.example', 'https://evil.example/']) {
    test(`P0-AUTH-02 next=${JSON.stringify(evil)} stays on this origin`, async ({ page, baseURL }) => {
      const c = credsFor('bar')
      await page.goto(`/login?next=${encodeURIComponent(evil)}`)
      await page.getByLabel('ชื่อผู้ใช้หรืออีเมล', { exact: true }).fill(c.username)
      await page.getByLabel('รหัสผ่าน', { exact: true }).fill(c.password)
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
      await expect(page).toHaveURL(/\/tonight$/)
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin)
    })
  }
})

test.describe('throttle + revocation', () => {
  test.use({ storageState: ANON })

  test('P0-AUTH-16 the 9th failed login for one identifier is throttled', async ({ request }) => {
    const who = `probe.${Date.now()}`
    for (let i = 1; i <= 8; i++) {
      const res = await request.post('/api/auth/login', { data: { identifier: who, password: 'wrong-password' } })
      expect(res.status(), `attempt ${i}`).toBe(401)
    }
    const ninth = await request.post('/api/auth/login', { data: { identifier: who, password: 'wrong-password' } })
    expect(ninth.status()).toBe(429)
    expect(await ninth.json()).toEqual({ error: 'rate_limited' })
  })

  test('P0-AUTH-04 a revoked session on / ends on /login without looping', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ANON })
    const page = await context.newPage()
    try {
      const c = credsFor('multi')
      const login = await page.request.post('/api/auth/login', { data: { identifier: c.username, password: c.password } })
      expect(login.status()).toBe(200)
      const cookies = await context.cookies()
      const raw = cookies.filter((k) => /^sb-.*-auth-token(\.\d+)?$/.test(k.name)).map((k) => k.value).join('')
      const session = JSON.parse(Buffer.from(raw.replace(/^base64-/, ''), 'base64url').toString('utf8')) as { access_token: string }
      const { error } = await adminDb().auth.admin.signOut(session.access_token, 'local')
      expect(error).toBeNull()
      const redirects: string[] = []
      page.on('response', (r) => { if (r.status() >= 300 && r.status() < 400) redirects.push(r.url()) })
      await page.goto('/')
      await expect(page).toHaveURL(/\/login/)
      expect(redirects.length).toBeLessThanOrEqual(3)
      expect((await context.cookies()).filter((k) => k.name.startsWith('sb-'))).toHaveLength(0)
    } finally {
      await context.close()
    }
  })
})

test.describe('signed in', () => {
  test('P0-AUTH-03 logout then Back stays on /login', async ({ browser }) => {
    // a fresh session of its own: logging out the shared storageState session would
    // revoke it for every later spec
    const context = await browser.newContext({ storageState: ANON })
    const page = await context.newPage()
    try {
      const c = credsFor('staff')
      const login = await page.request.post('/api/auth/login', { data: { identifier: c.username, password: c.password } })
      expect(login.status()).toBe(200)
      await page.goto('/tonight') // a history entry for Back to land on
      await page.goto('/me')
      await expect(page.getByRole('heading', { name: 'บัญชีของฉัน', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).first().click()
      await expect(page).toHaveURL(/\/login$/)
      await page.goBack()
      await expect(page).toHaveURL(/\/login/)
      const res = await page.request.get('/tonight', { maxRedirects: 0 })
      expect(res.status()).toBe(307)
    } finally {
      await context.close()
    }
  })
})
