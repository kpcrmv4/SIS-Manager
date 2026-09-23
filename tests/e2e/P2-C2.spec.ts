import { expect, test, type Page } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { BRANCH_A_CODE } from './fixtures/users'
import { bottles, cleanupRun, confirmAll, mustCreate } from './fixtures/deposits'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import { signCustomerToken } from './fixtures/p2c-token'
import { businessNight, weekdayIndex } from '../../src/lib/date'
import { TERMS_VERSION } from '../../src/components/liff/constants'

test.describe.configure({ mode: 'serial' })

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const codeLower = BRANCH_A_CODE.toLowerCase()

test.afterAll(async () => {
  await cleanupRun()
  await cleanupCustomers()
})

async function withCustomerDouble(page: Page, token: string) {
  await page.addInitScript((t) => {
    ;(window as unknown as { __SIS_LIFF_TEST__?: { customerToken: string } }).__SIS_LIFF_TEST__ = { customerToken: t }
  }, token)
}

test('P2-C2-01 the active tab lists only this customer\'s deposits of this branch', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const other = await makeCustomer()

  const mine = await mustCreate('staff', { qty: 2, customerId: me.id })
  await confirmAll(mine.id, [100, 100])
  const theirs = await mustCreate('staff', { qty: 1, customerId: other.id })
  await confirmAll(theirs.id, [100])

  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}`)

  const cards = page.getByTestId('cx-deposit-card')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toHaveAttribute('data-code', mine.code)
  await expect(page.locator(`[data-code="${theirs.code}"]`)).toHaveCount(0)
})

test('P2-C2-02 a withdraw request goes pending, by_customer true, and staff can see it', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const dep = await mustCreate('staff', { qty: 2, customerId: me.id })
  await confirmAll(dep.id, [100, 100])
  const bs = await bottles(dep.id)

  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}`)

  await page.getByTestId('cx-withdraw-open').first().click()
  await page.getByTestId(`cx-bottle-${bs[0].bottle_no}`).check()
  await page.getByTestId('cx-type-take-home').click()
  await page.getByLabel('โต๊ะของคุณ').fill('B5')
  await page.getByTestId('cx-withdraw-submit').click()
  await expect(page.getByText('ส่งคำขอเบิกแล้ว')).toBeVisible()

  const { data: w } = await adminDb()
    .from('withdrawals')
    .select('status, by_customer, customer_id, table_label, type')
    .eq('deposit_id', dep.id)
    .eq('bottle_id', bs[0].id)
    .single()
  expect(w).toMatchObject({ status: 'pending', by_customer: true, customer_id: me.id, table_label: 'B5', type: 'take_home' })

  // staff-side: the same withdrawal is visible to staff for this branch (the ขอเบิก tab's data source)
  const { data: staffView } = await dbAs('staff').from('withdrawals').select('id').eq('deposit_id', dep.id).eq('status', 'pending')
  expect((staffView ?? []).length).toBeGreaterThan(0)
  void branchA
})

test('P2-C2-03 in-store withdrawal is disabled on a blocked night, with a notice', async ({ page }) => {
  const { branchA } = fixtureIds()
  const todayName = DOW[weekdayIndex(businessNight())]
  const admin = adminDb()
  const { data: before } = await admin.from('branches').select('withdrawal_blocked_days').eq('id', branchA).single()
  await admin.from('branches').update({ withdrawal_blocked_days: [todayName] }).eq('id', branchA)

  try {
    const me = await makeCustomer()
    const dep = await mustCreate('staff', { qty: 1, customerId: me.id })
    await confirmAll(dep.id, [100])

    const token = signCustomerToken(me.id, branchA)
    await withCustomerDouble(page, token)
    await page.goto(`/liff/${codeLower}`)
    await page.getByTestId('cx-withdraw-open').first().click()

    await expect(page.getByTestId('cx-blocked-notice')).toBeVisible()
    await expect(page.getByTestId('cx-type-in-store')).toBeDisabled()
  } finally {
    await admin.from('branches').update({ withdrawal_blocked_days: before?.withdrawal_blocked_days ?? [] }).eq('id', branchA)
  }
})

test('P2-C2-04 a deposit request is refused without accepting terms, and stamped with the terms version once accepted', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}/deposit`)

  await page.getByTestId('cx-deposit-name').fill('คุณทดสอบ')
  await page.getByTestId('cx-deposit-item').fill('Regency')
  await page.getByTestId('cx-deposit-submit').click()
  await expect(page.getByTestId('cx-terms-error')).toBeVisible()

  const { count: before } = await adminDb().from('deposits').select('id', { count: 'exact', head: true }).eq('customer_id', me.id)
  expect(before).toBe(0)

  await page.getByTestId('cx-terms-accept').check()
  await page.getByTestId('cx-deposit-submit').click()
  await page.waitForURL(`**/liff/${codeLower}`)

  const { data } = await adminDb().from('deposits').select('status, terms_version, terms_locale, customer_id, item_name').eq('customer_id', me.id).single()
  expect(data).toMatchObject({ status: 'requested', terms_version: TERMS_VERSION, terms_locale: 'th', customer_id: me.id, item_name: 'Regency' })
})

test('P2-C2-05 the history tab shows a withdrawn deposit', async ({ page }) => {
  const { branchA } = fixtureIds()
  const me = await makeCustomer()
  const dep = await mustCreate('staff', { qty: 1, customerId: me.id })
  await confirmAll(dep.id, [100])
  const bs = await bottles(dep.id)

  const { data: wid, error: wErr } = await dbAs('bar').rpc('request_withdrawal', { p_deposit: dep.id, p_bottle_ids: [bs[0].id], p_type: 'take_home' })
  expect(wErr, wErr?.message).toBeNull()
  const withdrawalId = (wid as { withdrawal_ids: string[] }).withdrawal_ids[0]
  const { error: cErr } = await dbAs('bar').rpc('complete_withdrawals', { p_withdrawal_ids: [withdrawalId] })
  expect(cErr, cErr?.message).toBeNull()

  const token = signCustomerToken(me.id, branchA)
  await withCustomerDouble(page, token)
  await page.goto(`/liff/${codeLower}`)
  await page.getByTestId('cx-tab-history').click()

  const card = page.locator(`[data-code="${dep.code}"]`)
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-status', 'withdrawn')
})
