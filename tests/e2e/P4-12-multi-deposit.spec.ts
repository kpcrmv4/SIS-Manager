import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { BRANCH_A_CODE } from './fixtures/users'
import { RUN, cleanupRun, photo } from './fixtures/deposits'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import { signCustomerToken } from './fixtures/p2c-token'
import { renderMessage } from '../../src/lib/line/render'
import { TERMS_VERSION } from '../../src/components/liff/constants'

// R-068: one form, several liquors — each its own deposit and DEP code, all or nothing, one notice
test.describe.configure({ mode: 'serial' })
const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const NAME = `${RUN} หลายรายการ`
const PHOTO_PATH = join(tmpdir(), `p4-12-${Date.now()}.jpg`)
test.beforeAll(() => writeFileSync(PHOTO_PATH, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])))

async function codesFor(name: string) {
  const { data } = await adminDb().from('deposits').select('id, code, item_name, quantity, status').eq('customer_name', name).order('created_at').range(0, 49)
  return data ?? []
}

async function barNotices(kind: string, code: string) {
  const { users } = fixtureIds()
  const { data } = await adminDb().from('notifications').select('id, payload, link').eq('user_id', users.bar).eq('kind', kind).eq('payload->>code', code).range(0, 49)
  return data ?? []
}

test.afterAll(async () => {
  const admin = adminDb()
  const { data } = await admin.from('deposits').select('code').like('customer_name', `${RUN}%`).range(0, 999)
  const codes = (data ?? []).map((d) => d.code)
  if (codes.length) await admin.from('notifications').delete().in('payload->>code', codes)
  await cleanupRun()
  await cleanupCustomers()
})

test('P4-12-01 create_deposits: two items → two deposits, own codes and bottles, one bell notice for the batch', async () => {
  const { branchA } = fixtureIds()
  const name = `${NAME} 01`
  const { data, error } = await dbAs('staff').rpc('create_deposits', {
    p_branch: branchA,
    p_customer_name: name,
    p_items: [
      { item_name: 'Black Label', quantity: 2 },
      { item_name: 'Hennessy VSOP', quantity: 1 },
    ],
    p_photo_paths: [await photo()],
    p_table: 'B2',
  })
  expect(error, error?.message).toBeNull()
  const made = (data as { deposits: { id: string; code: string; item: string; quantity: number }[] }).deposits
  expect(made).toHaveLength(2)
  expect(made[0].code).not.toBe(made[1].code)

  const rows = await codesFor(name)
  expect(rows.map((r) => [r.item_name, r.quantity, r.status])).toEqual([
    ['Black Label', 2, 'pending_confirm'],
    ['Hennessy VSOP', 1, 'pending_confirm'],
  ])
  const { count: b1 } = await adminDb().from('deposit_bottles').select('id', { count: 'exact', head: true }).eq('deposit_id', made[0].id)
  const { count: b2 } = await adminDb().from('deposit_bottles').select('id', { count: 'exact', head: true }).eq('deposit_id', made[1].id)
  expect([b1, b2]).toEqual([2, 1])

  // one notice naming both items, pointing at the รอยืนยัน tab — none per item
  const batch = await barNotices('deposit_received', made[0].code)
  expect(batch).toHaveLength(1)
  expect(batch[0].link).toBe('/deposits?tab=toConfirm')
  expect((batch[0].payload as { item: string }).item).toBe('Black Label ×2 · Hennessy VSOP ×1')
  expect(await barNotices('deposit_received', made[1].code)).toHaveLength(0)
})

test('P4-12-02 one item still behaves as before: its own notice, linked to the deposit', async () => {
  const { branchA } = fixtureIds()
  const { data, error } = await dbAs('staff').rpc('create_deposits', {
    p_branch: branchA,
    p_customer_name: `${NAME} 02`,
    p_items: [{ item_name: 'Regency', quantity: 1 }],
    p_photo_paths: [await photo()],
  })
  expect(error, error?.message).toBeNull()
  const [one] = (data as { deposits: { id: string; code: string }[] }).deposits
  const notes = await barNotices('deposit_received', one.code)
  expect(notes).toHaveLength(1)
  expect(notes[0].link).toBe(`/deposits/${one.id}`)
})

test('P4-12-03 all or nothing: a bad second item saves neither', async () => {
  const { branchA } = fixtureIds()
  for (const bad of [{ item_name: '', quantity: 1 }, { item_name: 'Hennessy', quantity: 0 }]) {
    const name = `${NAME} 03 ${bad.quantity}`
    const { error } = await dbAs('staff').rpc('create_deposits', {
      p_branch: branchA,
      p_customer_name: name,
      p_items: [{ item_name: 'Black Label', quantity: 2 }, bad],
      p_photo_paths: [await photo()],
    })
    expect(error?.message).toMatch(/BAD_ITEMS|BAD_QUANTITY/)
    expect(await codesFor(name)).toHaveLength(0)
  }
  const { error: tooMany } = await dbAs('staff').rpc('create_deposits', {
    p_branch: branchA,
    p_customer_name: `${NAME} 03 many`,
    p_items: Array.from({ length: 11 }, () => ({ item_name: 'Regency', quantity: 1 })),
    p_photo_paths: [await photo()],
  })
  expect(tooMany?.message).toContain('BAD_ITEMS')
  // staff still needs a photo, as for one item
  const { error: noPhoto } = await dbAs('staff').rpc('create_deposits', {
    p_branch: branchA,
    p_customer_name: `${NAME} 03 photo`,
    p_items: [{ item_name: 'Regency', quantity: 1 }, { item_name: 'Black Label', quantity: 1 }],
    p_photo_paths: [],
  })
  expect(noPhoto?.message).toContain('PHOTO_REQUIRED')
  expect(await codesFor(`${NAME} 03 photo`)).toHaveLength(0)
})

test('P4-12-04 customer_request_deposits: two requests, one staff-group LINE message listing both, one bell notice', async () => {
  const { branchA, users } = fixtureIds()
  const admin = adminDb()
  const me = await makeCustomer()
  const { data: before } = await admin.from('branches').select('staff_group_id').eq('id', branchA).single()
  await admin.from('branches').update({ staff_group_id: 'Cfixturegroup0000000000000000000' }).eq('id', branchA)
  try {
    const name = `${NAME} 04`
    const { data, error } = await admin.rpc('customer_request_deposits', {
      p_branch: branchA,
      p_customer_id: me.id,
      p_customer_name: name,
      p_items: [
        { item_name: 'Black Label', quantity: 2 },
        { item_name: 'Hennessy', quantity: 1 },
      ],
      p_terms_version: TERMS_VERSION,
      p_terms_locale: 'th',
    })
    expect(error, error?.message).toBeNull()
    const made = (data as { deposits: { id: string; code: string }[] }).deposits
    expect(made).toHaveLength(2)
    expect((await codesFor(name)).every((r) => r.status === 'requested')).toBe(true)

    const { data: out } = await admin.from('line_outbox').select('payload, dedupe_key').eq('kind', 'deposit_requested').in('payload->>deposit_id', made.map((m) => m.id)).range(0, 9)
    expect(out).toHaveLength(1)
    const payload = out![0].payload as { items: { code: string }[]; count: number }
    expect(payload.items.map((i) => i.code)).toEqual(made.map((m) => m.code))
    expect(payload.count).toBe(3)
    await admin.from('line_outbox').delete().eq('dedupe_key', out![0].dedupe_key)

    const { data: bell } = await admin.from('notifications').select('link').eq('user_id', users.staff).eq('kind', 'deposit_requested').in('payload->>code', made.map((m) => m.code)).range(0, 9)
    expect(bell).toEqual([{ link: '/deposits?tab=requests' }])

    // the message: one bubble, each item on its own line with its code
    const msg = renderMessage('deposit_requested', 'th', { ...payload, customer: name }, {}) as { altText: string }
    expect(msg.altText).toContain('คำขอฝากใหม่ · 2 รายการ')
    for (const m of made) expect(msg.altText).toContain(m.code)
  } finally {
    await admin.from('branches').update({ staff_group_id: before?.staff_group_id ?? null }).eq('id', branchA)
  }
})

test.describe('staff form', () => {
  test.use({ storageState: as('staff') })

  test('P4-12-05 /deposits/new: add a second liquor, save both, the summary lists both codes and prints all', async ({ page }) => {
    const name = `${NAME} 05`
    await page.goto('/deposits/new')
    await expect(page.getByTestId('new-deposit-form')).toHaveAttribute('data-hydrated', 'true')
    await page.getByTestId('deposit-name').fill(name)
    await page.getByTestId('deposit-item').fill('Black Label')
    await page.getByTestId('deposit-quantity').fill('2')
    await page.getByTestId('deposit-add-item').click()
    await expect(page.getByTestId('deposit-item-row')).toHaveCount(2)
    await page.getByTestId('deposit-item-1').fill('Hennessy VSOP')
    await expect(page.getByTestId('deposit-submit')).toHaveText('บันทึกรับฝาก 2 รายการ')
    // an empty second row is caught on the page, nothing saved
    await page.getByTestId('deposit-item-1').fill('')
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('deposit-photo-add').click()
    await (await chooser).setFiles(PHOTO_PATH)
    await expect(page.getByTestId('photo-chip').first()).toBeVisible()
    await page.getByTestId('deposit-submit').click()
    await expect(page.getByText('เลือกหรือพิมพ์ชื่อเหล้า')).toBeVisible()
    expect(await codesFor(name)).toHaveLength(0)

    await page.getByTestId('deposit-item-1').fill('Hennessy VSOP')
    await page.getByTestId('deposit-submit').click()
    const saved = page.getByTestId('deposit-saved')
    await expect(saved).toContainText('รับฝากแล้ว 2 รายการ')
    const rows = await codesFor(name)
    expect(rows).toHaveLength(2)
    for (const r of rows) await expect(saved.locator(`[data-testid="deposit-saved-row"][data-code="${r.code}"]`)).toBeVisible()

    await page.getByTestId('deposit-saved-print').click()
    await expect(page.getByText('ส่งพิมพ์แล้ว 4 งาน')).toBeVisible()
    const { count } = await adminDb().from('print_jobs').select('id', { count: 'exact', head: true }).in('deposit_id', rows.map((r) => r.id))
    expect(count).toBe(4)

    await page.getByTestId('deposit-saved-another').click()
    await expect(page.getByTestId('deposit-item-row')).toHaveCount(1)
    await expect(page.getByTestId('deposit-name')).toHaveValue('')
  })
})

async function withCustomerDouble(page: Page, token: string) {
  await page.addInitScript((tk) => {
    ;(window as unknown as { __SIS_LIFF_TEST__?: unknown }).__SIS_LIFF_TEST__ = { customerToken: tk }
  }, token)
}

test('P4-12-06 LIFF: two liquors in one request → two requested deposits', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  await withCustomerDouble(page, signCustomerToken(me.id, branchA))
  await page.goto(`/liff/${BRANCH_A_CODE.toLowerCase()}/deposit`)
  await page.getByTestId('cx-deposit-name').fill(`${NAME} 06`)
  await page.getByTestId('cx-deposit-item').fill('Black Label')
  await page.getByTestId('cx-deposit-add-item').click()
  await page.getByTestId('cx-deposit-item-1').fill('Hennessy')
  await page.getByTestId('cx-deposit-qty-1').getByRole('button', { name: '+' }).click()
  await page.getByTestId('cx-terms-accept').check()
  await page.getByTestId('cx-deposit-submit').click()
  await page.waitForURL(`**/liff/${BRANCH_A_CODE.toLowerCase()}`)
  const { data } = await adminDb().from('deposits').select('item_name, quantity, status').eq('customer_id', me.id).order('created_at').range(0, 9)
  expect(data).toEqual([
    { item_name: 'Black Label', quantity: 1, status: 'requested' },
    { item_name: 'Hennessy', quantity: 2, status: 'requested' },
  ])
})
