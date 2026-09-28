import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { RUN, bottles, cleanupRun, confirmAll, deposit, mustCreate, photo } from './fixtures/deposits'
import { bottleIds, createLineRequest, forceExpired, requestWithdrawal } from './fixtures/p2a-flows'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
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
      await expect(page.getByTestId('deposit-photo-error')).toHaveText('ต้องมีรูปเหล้าอย่างน้อย 1 รูป')
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
      // R-075: bar goes straight on to confirming it
      await page.waitForURL(/\/deposits\/[0-9a-f-]{36}\?open=confirm$/)
      await expect(page.getByTestId('confirm-submit')).toBeVisible()
      const id = new URL(page.url()).pathname.split('/').pop()!
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
      await page.getByTestId('confirm-submit').click()
      await expect(page.getByText(/^ยืนยันเหล้าแล้ว/)).toBeVisible()
      const row = await deposit(dep.id)
      expect(row.status).toBe('in_store')
      const { data: bottles } = await adminDb().from('deposit_bottles').select('status').eq('deposit_id', dep.id).order('bottle_no')
      expect(bottles!.map((b) => b.status)).toEqual(['sealed', 'opened', 'consumed'])
    })

    test('P2-A2-18 confirm dialog prints the receipt and the label by default; unticked prints nothing', async ({ page }) => {
      const jobs = async (id: string) =>
        ((await adminDb().from('print_jobs').select('job_type').eq('deposit_id', id)).data ?? []).map((j) => j.job_type).sort()

      const dep = await mustCreate('staff', { qty: 1 })
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-confirm').click()
      await expect(page.getByTestId('confirm-print-receipt')).toBeChecked()
      await expect(page.getByTestId('confirm-print-label')).toBeChecked()
      await expect(page.getByTestId('confirm-submit')).toHaveText('ยืนยันเก็บเข้าชั้นและพิมพ์')
      await attachPhoto(page, 'confirm-photo-add')
      await page.getByTestId('confirm-submit').click()
      await expect(page.getByText('ยืนยันเหล้าแล้ว · ส่งพิมพ์แล้ว', { exact: true })).toBeVisible()
      expect((await deposit(dep.id)).status).toBe('in_store')
      expect(await jobs(dep.id)).toEqual(['label', 'receipt'])

      // only the label
      const one = await mustCreate('staff', { qty: 1 })
      await page.goto(`/deposits/${one.id}`)
      await page.getByTestId('action-confirm').click()
      await page.getByTestId('confirm-print-receipt').uncheck()
      await attachPhoto(page, 'confirm-photo-add')
      await page.getByTestId('confirm-submit').click()
      await expect(page.getByText('ยืนยันเหล้าแล้ว · ส่งพิมพ์แล้ว', { exact: true })).toBeVisible()
      expect(await jobs(one.id)).toEqual(['label'])

      // neither: confirmed, nothing printed
      const none = await mustCreate('staff', { qty: 1 })
      await page.goto(`/deposits/${none.id}`)
      await page.getByTestId('action-confirm').click()
      await page.getByTestId('confirm-print-receipt').uncheck()
      await page.getByTestId('confirm-print-label').uncheck()
      await expect(page.getByTestId('confirm-submit')).toHaveText('ยืนยันเก็บเข้าชั้น')
      await attachPhoto(page, 'confirm-photo-add')
      await page.getByTestId('confirm-submit').click()
      await expect(page.getByText(/^ยืนยันเหล้าแล้ว/)).toBeVisible()
      expect((await deposit(none.id)).status).toBe('in_store')
      expect(await jobs(none.id)).toEqual([])
    })

    test('P2-A2-20 bar confirms against the liquor list: not found, search, add a name, and staff typed freely', async ({ page }) => {
      const { branchA } = fixtureIds()
      // staff typed a name the list does not have
      const typed = `${RUN} จอนนี่ ดำ`
      const { data: made, error } = await dbAs('staff').rpc('create_deposit', {
        p_branch: branchA,
        p_customer_name: `${RUN} ลูกค้า`,
        p_item_name: typed,
        p_quantity: 1,
        p_photo_paths: [await photo()],
      })
      expect(error, error?.message).toBeNull()
      const dep = made as { id: string }

      // the database refuses a confirm with no list item
      expect((await dbAs('bar').rpc('confirm_deposit', { p_deposit: dep.id, p_levels: [100], p_photo_paths: [await photo()] })).error?.message).toBe('ITEM_REQUIRED')

      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-confirm').click()
      await expect(page.getByTestId('confirm-item-not-found')).toHaveText('ไม่เจอชื่อเหล้า')
      await expect(page.getByTestId('confirm-item')).toContainText(`ที่พิมพ์มา: ${typed}`)
      await attachPhoto(page, 'confirm-photo-add')
      await page.getByTestId('confirm-print-receipt').uncheck()
      await page.getByTestId('confirm-print-label').uncheck()
      await page.getByTestId('confirm-submit').click()
      await expect(page.getByTestId('confirm-item')).toContainText('เลือกชื่อเหล้าจากรายการก่อนยืนยัน')
      expect((await deposit(dep.id)).status).toBe('pending_confirm')

      // search finds the list's name; change goes back to the search
      await page.getByTestId('confirm-item-search').fill('johnnie')
      await page.getByTestId('confirm-item-option').filter({ has: page.getByText('Johnnie Walker Black Label', { exact: true }) }).first().click()
      await expect(page.getByTestId('confirm-item-name')).toHaveText('Johnnie Walker Black Label')
      await page.getByTestId('confirm-item-change').click()

      // or add the missing name: it joins the branch's list and is picked
      const newName = `${RUN} Blue Label`
      await page.getByTestId('confirm-item-add').click()
      await page.getByTestId('add-item-name').fill(newName)
      await page.getByTestId('add-item-category').selectOption('whisky')
      await page.getByTestId('add-item-save').click()
      await expect(page.getByTestId('confirm-item-name')).toHaveText(newName)
      await page.getByTestId('confirm-submit').click()
      await expect(page.getByText(/^ยืนยันเหล้าแล้ว/)).toBeVisible()

      const row = await deposit(dep.id)
      const { data: item } = await adminDb().from('liquor_items').select('id, branch_id, category').eq('name', newName).single()
      expect(item).toMatchObject({ branch_id: branchA, category: 'whisky' })
      expect(row).toMatchObject({ status: 'in_store', item_id: item!.id, item_name: newName, category: 'whisky' })
      const { data: ev } = await adminDb().from('deposit_events').select('payload').eq('deposit_id', dep.id).eq('action', 'confirmed').single()
      expect(ev!.payload).toMatchObject({ item: newName, typed })

      // adding a name the list has reuses it; staff may not add
      const again = await dbAs('bar').rpc('add_liquor_item', { p_branch: branchA, p_name: `  ${newName.toUpperCase()} `, p_category: 'other' })
      expect(again.data).toMatchObject({ id: item!.id, existed: true })
      expect((await dbAs('staff').rpc('add_liquor_item', { p_branch: branchA, p_name: 'x', p_category: 'other' })).error?.message).toBe('BAR_ONLY')
      await adminDb().from('deposits').delete().eq('id', dep.id)
      await adminDb().from('liquor_items').delete().eq('id', item!.id)
    })

    test('P2-A2-19 the customer card lists what LINE told the customer; no "ส่ง" badge beside the switch', async ({ page }) => {
      const me = await makeCustomer()
      const dep = await mustCreate('staff', { qty: 1, customerId: me.id })
      await confirmAll(dep.id, [100])
      await page.goto(`/deposits/${dep.id}`)
      const reminders = page.getByTestId('customer-reminders')
      await expect(reminders.getByRole('switch')).toBeVisible()
      await expect(reminders.getByText('ส่ง', { exact: true })).toHaveCount(0)
      const history = page.getByTestId('line-history')
      await expect(history).toContainText('ประวัติแจ้งเตือน LINE')
      await history.locator('summary').click()
      const row = history.getByTestId('line-history-row').filter({ hasText: 'ยืนยันรับฝาก' })
      await expect(row).toHaveCount(1)
      await expect(row).toHaveAttribute('data-kind', 'deposit_confirmed')
      // read only inside the reader's branches
      const { error } = await dbAs('staffB').rpc('deposit_line_history', { p_deposit: dep.id })
      expect(error?.message).toBe('FORBIDDEN')
      const { data } = await dbAs('staff').rpc('deposit_line_history', { p_deposit: dep.id })
      expect((data as { kind: string }[]).map((r) => r.kind)).toContain('deposit_confirmed')
      await cleanupCustomers()
    })

    test('P2-A2-17 confirm dialog: type the % or drag the bar — one number; the list reads 100% with a level bar', async ({ page }) => {
      const dep = await mustCreate('staff', { qty: 2 })
      await page.goto(`/deposits/${dep.id}`)
      await page.getByTestId('action-confirm').click()
      const num2 = page.getByTestId('confirm-level-2')
      const bar2 = page.getByTestId('confirm-level-range-2')
      await expect(bar2).toHaveValue('100')
      await num2.fill('60')
      await expect(bar2).toHaveValue('60')
      // the bar moves in steps of 5 and the number follows it
      await bar2.focus()
      await page.keyboard.press('ArrowLeft')
      await expect(num2).toHaveValue('55')
      await bar2.fill('30')
      await expect(num2).toHaveValue('30')
      // typing past the ends stays inside 0–100
      await num2.fill('150')
      await expect(num2).toHaveValue('100')
      await num2.fill('45')
      await attachPhoto(page, 'confirm-photo-add')
      await page.getByTestId('confirm-submit').click()
      await expect(page.getByText(/^ยืนยันเหล้าแล้ว/)).toBeVisible()
      const { data: bottles } = await adminDb().from('deposit_bottles').select('remaining_percent').eq('deposit_id', dep.id).order('bottle_no')
      expect(bottles!.map((b) => Number(b.remaining_percent))).toEqual([100, 45])

      // a sealed deposit reads 100%, never "ยังไม่เปิด", with its bar on a phone
      const sealed = await mustCreate('staff', { qty: 2 })
      await confirmAll(sealed.id, [100, 100])
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/deposits?q=${sealed.code}`)
      const level = page.getByTestId('deposits-list-mobile').getByTestId('deposit-row-level')
      await expect(level).toHaveText('2 ขวด · 100%')
      await expect(level.locator('.level-bar > i')).toHaveAttribute('style', /width: ?100%/)
      await expect(page.getByText('ยังไม่เปิด')).toHaveCount(0)
    })

    test('P2-A2-22 bar receives a LINE request and confirms it in one step (R-075)', async ({ page }) => {
      const { branchA } = fixtureIds()
      const req = await createLineRequest(branchA, { qty: 2, item: `${RUN} Johnnie Walker Black Label` })
      const { users } = fixtureIds()
      const { count: noticesBefore } = await adminDb().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', users.bar).eq('kind', 'deposit_received').eq('payload->>deposit_id', req.id)
      await page.goto(`/deposits/${req.id}`)
      await expect(page.getByTestId('deposit-next')).toContainText('กด รับและยืนยันเหล้า')
      const btn = page.getByTestId('action-receive')
      await expect(btn).toHaveText('รับและยืนยันเหล้า')
      await btn.click()
      await expect(page.getByTestId('confirm-count')).toHaveValue('2')
      await page.getByTestId('confirm-count').fill('3')
      await expect(page.getByTestId('confirm-level-3')).toBeVisible()
      await page.getByTestId('confirm-level-2').fill('40')
      await page.getByTestId('confirm-print-receipt').uncheck()
      await page.getByTestId('confirm-print-label').uncheck()
      await attachPhoto(page, 'confirm-photo-add')
      await page.getByTestId('confirm-submit').click()
      await expect.poll(async () => (await deposit(req.id)).status).toBe('in_store')
      const row = await deposit(req.id)
      expect(row.quantity).toBe(3)
      const levels = (await bottles(req.id)).map((b) => Number(b.remaining_percent))
      expect(levels).toEqual([100, 40, 100])
      // no "bottles to confirm" notice — the one receiving is the one confirming
      const { count: noticesAfter } = await adminDb().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', users.bar).eq('kind', 'deposit_received').eq('payload->>deposit_id', req.id)
      expect(noticesAfter).toBe(noticesBefore)
      // staff cannot call it
      const { error } = await dbAs('staff').rpc('receive_and_confirm', { p_deposit: req.id, p_levels: [100], p_photo_paths: ['x'] })
      expect(error?.message).toMatch(/FORBIDDEN|BAR_ONLY|42501|permission/i)
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
      await expect(page.getByTestId('history-event').filter({ hasText: `${RUN} เหตุผลทดสอบ` })).toBeVisible()
      // and the state card says why (R-045)
      await expect(page.getByTestId('deposit-next')).toContainText(`${RUN} เหตุผลทดสอบ`)
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

      // P2-A2-21: staff sees what is waiting — which bottle, who asked — and asking again is secondary
      await page.reload()
      const panel = page.getByTestId('withdrawal-panel')
      await expect(panel).toHaveAttribute('data-can-decide', 'false')
      await expect(panel).toContainText('คำขอเบิก 1 ขวด · รอยืนยัน')
      await expect(panel.getByTestId('withdrawal-pending-row')).toHaveCount(1)
      await expect(panel.getByTestId('withdrawal-pending-row')).toContainText('ขวด 1 · กลับบ้าน')
      await expect(panel.getByTestId('withdrawal-pending-row')).toContainText('ขอโดย')
      await expect(page.getByTestId('withdrawal-wait-note')).toBeVisible()
      await expect(page.getByTestId('withdrawal-complete-open')).toHaveCount(0)
      await expect(page.getByTestId('bottle-1-pending')).toBeVisible()
      await expect(page.getByTestId('bottle-2-pending')).toHaveCount(0)
      await expect(page.getByTestId('withdraw-new-section')).toContainText('เบิกใหม่')
      await expect(page.getByTestId('withdraw-new-section')).toContainText('ยังเบิกได้อีก 1 ขวด')
      const more = page.getByTestId('action-withdraw')
      await expect(more).toHaveAttribute('data-more', 'true')
      await expect(more).toHaveText('เบิกขวดอื่นเพิ่ม')
      await more.click()
      await expect(page.getByTestId('withdraw-already-pending')).toContainText('ขวด 1 มีคำขอเบิกรอยืนยันอยู่แล้ว')
      await expect(page.getByTestId('withdraw-bottle-1')).toHaveCount(0)
      await page.getByTestId('withdraw-bottle-2').check()
      await page.getByTestId('withdraw-submit').click()
      await expect(page.getByText('สร้างคำขอเบิกแล้ว', { exact: true })).toBeVisible()
      // every bottle asked for: no withdraw button left
      await page.reload()
      await expect(page.getByTestId('withdrawal-pending-row')).toHaveCount(2)
      await expect(page.getByTestId('action-withdraw')).toHaveCount(0)

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

    test('P2-A2-14 LINE request → รับเหล้า (qty + photo) → pending_confirm with bottles', async ({ page }) => {
      const { branchA } = fixtureIds()
      const req = await createLineRequest(branchA, { qty: 2 })
      await page.goto(`/deposits/${req.id}`)
      // (owner, 2026-09-28) staff are told to hand the bottles to bar after the photo
      await expect(page.getByTestId('deposit-next')).toContainText('กดปุ่ม รับเหล้า และถ่ายรูป จากนั้นนำส่งให้ bar')
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
