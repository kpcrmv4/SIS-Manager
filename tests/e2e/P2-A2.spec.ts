import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { RUN, cleanupRun, confirmAll, deposit, mustCreate } from './fixtures/deposits'
import { bottleIds, createLineRequest, forceExpired, requestWithdrawal } from './fixtures/p2a-flows'
import { addDays, bangkokDate, businessNight, weekdayIndex } from '../../src/lib/date'

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

test.describe.configure({ mode: 'serial' })

let itemId = ''
const PHOTO_PATH = join(tmpdir(), `p2a2-${Date.now()}.jpg`)

test.beforeAll(async () => {
  writeFileSync(PHOTO_PATH, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]))
  const { branchA } = fixtureIds()
  const { data, error } = await adminDb().from('liquor_items').insert({ branch_id: branchA, name: `${RUN} Johnnie Walker Black Label`, category: 'whisky' }).select('id').single()
  expect(error, error?.message).toBeNull()
  itemId = data!.id
})

test.afterAll(async () => {
  await cleanupRun()
  await adminDb().from('liquor_items').delete().eq('id', itemId)
  const { branchA } = fixtureIds()
  await adminDb().from('branches').update({ withdrawal_blocked_days: ['Fri', 'Sat'] }).eq('id', branchA)
})

async function attachPhoto(page: import('@playwright/test').Page, addButtonTestId: string) {
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByTestId(addButtonTestId).click()
  const chooser = await fileChooserPromise
  await chooser.setFiles(PHOTO_PATH)
  // uploadDepositPhoto is async — wait for the chip that proves it landed.
  await expect(page.getByTestId('photo-chip').first()).toBeVisible()
}

test.describe('new deposit form', () => {
  test.describe('staff', () => {
    test.use({ storageState: as('staff') })

    test('P2-A2-01 happy path: item from the list, 3 bottles, photo → pending_confirm', async ({ page }) => {
      await page.goto('/deposits/new')
      await page.getByTestId('deposit-name').fill(`${RUN} คุณทดสอบ`)
      await page.getByTestId('deposit-item').fill(`${RUN} Johnnie Walker Black Label`)
      await page.getByTestId('deposit-quantity').fill('3')
      await attachPhoto(page, 'deposit-photo-add')
      await page.getByTestId('deposit-submit').click()
      await page.waitForURL(/\/deposits\/[0-9a-f-]{36}$/)
      const id = page.url().split('/').pop()!
      const row = await deposit(id)
      expect(row.status).toBe('pending_confirm')
      expect(row.quantity).toBe(3)
      expect(row.item_id).toBe(itemId)
    })

    test('P2-A2-02 submit without a photo shows an inline error and creates nothing', async ({ page }) => {
      const { count: before } = await adminDb().from('deposits').select('id', { count: 'exact', head: true }).like('customer_name', `${RUN}%`)
      await page.goto('/deposits/new')
      await page.getByTestId('deposit-name').fill(`${RUN} ไม่มีรูป`)
      await page.getByTestId('deposit-item').fill(`${RUN} Johnnie Walker Black Label`)
      await page.getByTestId('deposit-quantity').fill('1')
      await page.getByTestId('deposit-submit').click()
      await expect(page.getByTestId('deposit-photo-error')).toHaveText('ต้องมีรูปขวดอย่างน้อย 1 รูป')
      await expect(page).toHaveURL(/\/deposits\/new$/)
      const { count: after } = await adminDb().from('deposits').select('id', { count: 'exact', head: true }).like('customer_name', `${RUN}%`)
      expect(after).toBe(before)
    })

    test('P2-A2-03 staff: expiry is shown and disabled at the branch default', async ({ page }) => {
      await page.goto('/deposits/new')
      const exp = page.getByTestId('deposit-expires')
      await expect(exp).toBeDisabled()
      await expect(exp).toHaveValue(/30 วัน/)
    })

    test('P2-A2-04 a free-typed item not in the list is saved with item_id null', async ({ page }) => {
      await page.goto('/deposits/new')
      await page.getByTestId('deposit-name').fill(`${RUN} พิมพ์เอง`)
      await page.getByTestId('deposit-item').fill(`${RUN} เหล้าพิเศษไม่มีในรายการ`)
      await page.getByTestId('deposit-quantity').fill('1')
      await attachPhoto(page, 'deposit-photo-add')
      await page.getByTestId('deposit-submit').click()
      await page.waitForURL(/\/deposits\/[0-9a-f-]{36}$/)
      const id = page.url().split('/').pop()!
      const row = await deposit(id)
      expect(row.item_id).toBeNull()
      expect(row.item_name).toBe(`${RUN} เหล้าพิเศษไม่มีในรายการ`)
    })

    test('P2-A2-16 double submit: the button disables and exactly one deposit is created', async ({ page }) => {
      await page.goto('/deposits/new')
      await page.getByTestId('deposit-name').fill(`${RUN} กดซ้ำ`)
      await page.getByTestId('deposit-item').fill(`${RUN} Johnnie Walker Black Label`)
      await page.getByTestId('deposit-quantity').fill('1')
      await attachPhoto(page, 'deposit-photo-add')
      const submit = page.getByTestId('deposit-submit')
      await submit.click()
      await expect(submit).toBeDisabled()
      await page.waitForURL(/\/deposits\/[0-9a-f-]{36}$/)
      const { count } = await adminDb().from('deposits').select('id', { count: 'exact', head: true }).eq('customer_name', `${RUN} กดซ้ำ`)
      expect(count).toBe(1)
    })
  })

  test.describe('bar', () => {
    test.use({ storageState: as('bar') })

    test('P2-A2-03 bar: expiry is editable and the saved value matches the chosen date', async ({ page }) => {
      await page.goto('/deposits/new')
      await expect(page.getByTestId('new-deposit-form')).toHaveAttribute('data-hydrated', 'true')
      const exp = page.getByTestId('deposit-expires')
      await expect(exp).toBeEditable()
      const chosen = addDays(bangkokDate(), 90)
      await exp.fill(chosen)
      await expect(exp).toHaveValue(chosen) // a date input can silently ignore a fill before it settles
      await page.getByTestId('deposit-name').fill(`${RUN} bar หมดอายุเอง`)
      await page.getByTestId('deposit-item').fill(`${RUN} Johnnie Walker Black Label`)
      await page.getByTestId('deposit-quantity').fill('1')
      await attachPhoto(page, 'deposit-photo-add')
      await page.getByTestId('deposit-submit').click()
      await page.waitForURL(/\/deposits\/[0-9a-f-]{36}$/)
      const id = page.url().split('/').pop()!
      const row = await deposit(id)
      expect(row.expires_at!.slice(0, 10)).toBe(chosen)
    })
  })
})

test.describe('detail dialogs', () => {
  test.describe('bar', () => {
    test.use({ storageState: as('bar') })

    test('P2-A2-05 confirm dialog: levels 100/60/0 + photo → in_store, bottle states', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 3 })
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-confirm').click()
      await page.getByTestId('confirm-level-1').fill('100')
      await page.getByTestId('confirm-level-2').fill('60')
      await page.getByTestId('confirm-level-3').fill('0')
      await attachPhoto(page, 'confirm-photo-add')
      await page.getByRole('button', { name: 'ยืนยันเก็บเข้าชั้น', exact: true }).click()
      await expect(page.getByText('ยืนยันขวดแล้ว', { exact: true })).toBeVisible()
      const row = await deposit(dep.id)
      expect(row.status).toBe('in_store')
      const { data: bottles } = await adminDb().from('deposit_bottles').select('status').eq('deposit_id', dep.id).order('bottle_no')
      expect(bottles!.map((b) => b.status)).toEqual(['sealed', 'opened', 'consumed'])
    })

    test('P2-A2-06 reject a deposit with a reason → cancelled, reason in history', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 1 })
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-reject').click()
      await page.locator('#reject-reason').fill(`${RUN} เหตุผลทดสอบ`)
      await page.getByTestId('reject-submit').click()
      await expect(page.getByText('ปฏิเสธแล้ว', { exact: true })).toBeVisible()
      const row = await deposit(dep.id)
      expect(row.status).toBe('cancelled')
      await expect(page.getByText(`${RUN} เหตุผลทดสอบ`, { exact: false })).toBeVisible()
    })

    test('P2-A2-09 complete a pending withdrawal from the detail page', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 2 })
      await confirmAll(dep.id, [100, 100])
      const ids = await bottleIds(dep.id)
      await requestWithdrawal(dep.id, [ids[0]], 'take_home', 'staff')
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('withdrawal-complete-open').click()
      await page.getByTestId('withdrawal-complete-submit').click()
      await expect(page.getByText('เบิกเหล้าแล้ว', { exact: true })).toBeVisible()
      const { data: w } = await adminDb().from('withdrawals').select('status').eq('deposit_id', dep.id)
      expect(w!.every((x) => x.status === 'completed')).toBe(true)
    })

    test('P2-A2-10 reject a pending withdrawal → deposit back in store', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 2 })
      await confirmAll(dep.id, [100, 100])
      const ids = await bottleIds(dep.id)
      await requestWithdrawal(dep.id, [ids[0]], 'take_home', 'staff')
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('withdrawal-reject-open').click()
      await page.locator('#withdrawal-reject-reason').fill(`${RUN} ปฏิเสธ`)
      await page.getByTestId('withdrawal-reject-submit').click()
      await expect(page.getByText('ปฏิเสธการเบิกแล้ว', { exact: true })).toBeVisible()
      const row = await deposit(dep.id)
      expect(row.status).toBe('in_store')
    })

    test('P2-A2-11 extend +30 days shows the new expiry in history', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 1 })
      await confirmAll(dep.id, [100])
      const before = await deposit(dep.id)
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-extend').click()
      await page.locator('#extend-days').fill('30')
      await page.getByTestId('extend-submit').click()
      await expect(page.getByText('ต่ออายุแล้ว', { exact: true })).toBeVisible()
      const after = await deposit(dep.id)
      expect(new Date(after.expires_at!).getTime()).toBeGreaterThan(new Date(before.expires_at!).getTime())
      await expect(page.getByText('ต่ออายุถึง', { exact: false })).toBeVisible()
    })

    test('P2-A2-12 VIP on then off', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 1 })
      await confirmAll(dep.id, [100])
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-vip').click()
      await page.getByTestId('vip-submit').click()
      await expect(page.getByText('อัปเดตแล้ว', { exact: true })).toBeVisible()
      // wait for the server refresh to land (the button's own label flips once isVip is fresh)
      // before acting again, or the second click races the still-stale `isVip` prop.
      await expect(page.getByTestId('action-vip')).toHaveText('ยกเลิก VIP')
      expect((await deposit(dep.id)).is_vip).toBe(true)
      await expect(page.getByText('ไม่หมดอายุ', { exact: true }).first()).toBeVisible()

      await page.getByTestId('action-vip').click()
      await page.getByTestId('vip-submit').click()
      await expect(page.getByText('อัปเดตแล้ว', { exact: true })).toBeVisible()
      await expect(page.getByTestId('action-vip')).toHaveText('ตั้งเป็น VIP')
      expect((await deposit(dep.id)).is_vip).toBe(false)
    })

    test('P2-A2-13 expired tab: select 2, dispose with a confirm dialog', async ({ page }) => {
      const d1 = await mustCreate('staff', { qty: 1 })
      await confirmAll(d1.id, [100])
      await forceExpired(d1.id)
      const d2 = await mustCreate('staff', { qty: 1 })
      await confirmAll(d2.id, [100])
      await forceExpired(d2.id)

      await page.goto('/deposits?tab=expired')
      await page.getByTestId(`expired-select-${d1.id}`).check()
      await page.getByTestId(`expired-select-${d2.id}`).check()
      await page.getByTestId('dispose-open').click()
      await page.getByTestId('dispose-submit').click()
      await expect(page.getByText('จำหน่ายออกแล้ว', { exact: false })).toBeVisible()
      expect((await deposit(d1.id)).status).toBe('disposed')
      expect((await deposit(d2.id)).status).toBe('disposed')
    })

    test('P2-A2-15 an action error toasts the catalog text and leaves the dialog open', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 1 })
      await confirmAll(dep.id, [100])
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-extend').click()
      await page.locator('#extend-days').fill('0')
      const submit = page.getByTestId('extend-submit')
      await submit.click()
      await expect(page.getByText('จำนวนวันต้องเป็น 1–365', { exact: true })).toBeVisible()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(submit).toBeEnabled()
    })
  })

  test.describe('staff', () => {
    test.use({ storageState: as('staff') })

    test('P2-A2-07 withdraw dialog: pick 1 bottle, take home → pending_withdrawal, in ขอเบิก tab', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 2 })
      await confirmAll(dep.id, [100, 100])
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-withdraw').click()
      await page.getByTestId('withdraw-bottle-1').check()
      await page.getByText('กลับบ้าน', { exact: true }).click()
      await page.getByTestId('withdraw-submit').click()
      await expect(page.getByText('สร้างคำขอเบิกแล้ว', { exact: true })).toBeVisible()
      const row = await deposit(dep.id)
      expect(row.status).toBe('pending_withdrawal')
      await page.goto('/deposits?tab=withdraw')
      await expect(page.getByText(dep.code, { exact: true }).first()).toBeVisible()
    })

    test('P2-A2-08 withdraw on a blocked night: notice shown, in-store disabled, take-home allowed', async ({ page }) => {
      const { branchA } = fixtureIds()
      const today = DOW[weekdayIndex(businessNight())]
      const { error } = await adminDb().from('branches').update({ withdrawal_blocked_days: [today] }).eq('id', branchA)
      expect(error, error?.message).toBeNull()
      try {
        const dep = await mustCreate('staff', { qty: 1 })
        await confirmAll(dep.id, [100])
        await page.goto(`/deposits/${dep.id}`)
        await page.getByTestId('action-withdraw').click()
        await expect(page.getByTestId('withdraw-blocked-notice')).toBeVisible()
        await expect(page.getByText('วันนี้เป็นวันงดเบิกดื่มในร้าน เบิกกลับบ้านได้', { exact: true })).toBeVisible()
        const inStoreOption = page.locator('input[name="withdraw-type"]').first()
        await expect(inStoreOption).toBeDisabled()
        await page.getByTestId('withdraw-bottle-1').check()
        await page.getByTestId('withdraw-submit').click()
        await expect(page.getByText('สร้างคำขอเบิกแล้ว', { exact: true })).toBeVisible()
        const row = await deposit(dep.id)
        expect(row.status).toBe('pending_withdrawal')
        const { data: w } = await adminDb().from('withdrawals').select('type').eq('deposit_id', dep.id).single()
        expect(w!.type).toBe('take_home')
      } finally {
        await adminDb().from('branches').update({ withdrawal_blocked_days: ['Fri', 'Sat'] }).eq('id', branchA)
      }
    })

    test('P2-A2-14 LINE request → รับขวด (qty + photo) → pending_confirm with bottles', async ({ page }) => {
      const { branchA } = fixtureIds()
      const req = await createLineRequest(branchA, { qty: 2 })
      await page.goto(`/deposits/${req.id}`)
      await page.getByTestId('action-receive').click()
      await page.locator('#receive-qty').fill('2')
      await attachPhoto(page, 'receive-photo-add')
      await page.getByTestId('receive-submit').click()
      await expect(page.getByText('รับฝากแล้ว', { exact: false })).toBeVisible()
      const row = await deposit(req.id)
      expect(row.status).toBe('pending_confirm')
      const { data: bottles } = await adminDb().from('deposit_bottles').select('id').eq('deposit_id', req.id)
      expect(bottles!.length).toBe(2)
    })
  })
})
