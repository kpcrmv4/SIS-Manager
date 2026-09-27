import { expect, test, type Page } from '@playwright/test'
import { adminDb, fixtureIds } from './fixtures/db'
import { BRANCH_A_CODE } from './fixtures/users'
import { RUN, cleanupRun, mustCreate } from './fixtures/deposits'
import { cleanupCustomers, makeCustomer } from './fixtures/p2c-customers'
import { signCustomerToken } from './fixtures/p2c-token'

/**
 * P4-10 — the LIFF forms remember the customer (R-065): the name and phone they last gave fill the
 * next form, from their latest deposit or booking until they send one themselves; what they send
 * becomes the remembered value; their LINE name when there is nothing else.
 */
test.describe.configure({ mode: 'serial' })

const codeLower = BRANCH_A_CODE.toLowerCase()

test.afterAll(async () => {
  await cleanupRun()
  await cleanupCustomers()
})

async function asCustomer(page: Page, customerId: string) {
  const token = signCustomerToken(customerId, fixtureIds().branchA)
  await page.addInitScript((t) => {
    ;(window as unknown as { __SIS_LIFF_TEST__?: { customerToken: string } }).__SIS_LIFF_TEST__ = { customerToken: t }
  }, token)
}

test('P4-10-01 a returning customer finds the form filled; what they send is remembered for next time', async ({ page }) => {
  const me = await makeCustomer()
  // their earlier deposit, taken by staff: name and phone come from it
  await mustCreate('staff', { qty: 1, customerId: me.id })
  await asCustomer(page, me.id)
  await page.goto(`/liff/${codeLower}/deposit`)
  await expect(page.getByTestId('cx-deposit-name')).toHaveValue(`${RUN} ลูกค้า`)
  await expect(page.getByTestId('cx-deposit-phone')).toHaveValue('081-234-5678')

  // they change both and send
  await page.getByTestId('cx-deposit-name').fill(`${RUN} ชื่อใหม่`)
  await page.getByTestId('cx-deposit-phone').fill('089-999-0000')
  await page.getByTestId('cx-deposit-item').fill('Regency')
  await page.getByTestId('cx-terms-accept').check()
  await page.getByTestId('cx-deposit-submit').click()
  await page.waitForURL(`**/liff/${codeLower}`)
  await expect
    .poll(async () => (await adminDb().from('customers').select('contact_name, phone').eq('id', me.id).single()).data)
    .toEqual({ contact_name: `${RUN} ชื่อใหม่`, phone: '089-999-0000' })

  // the booking form fills in the same
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`/liff/${codeLower}/book`)
  await expect(page.getByTestId('cx-book-name')).toHaveValue(`${RUN} ชื่อใหม่`)
  await expect(page.getByTestId('cx-book-phone')).toHaveValue('089-999-0000')
})

test('P4-10-02 a first-time customer starts with their LINE name and no phone', async ({ page }) => {
  const me = await makeCustomer({ name: `${RUN} LINE name` })
  await asCustomer(page, me.id)
  await page.goto(`/liff/${codeLower}/deposit`)
  await expect(page.getByTestId('cx-deposit-name')).toHaveValue(`${RUN} LINE name`)
  await expect(page.getByTestId('cx-deposit-phone')).toHaveValue('')
})
