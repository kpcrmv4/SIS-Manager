import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { cleanupRun, confirmAll, createDeposit, mustCreate } from './fixtures/deposits'

/**
 * P4-11 — more from realtime (R-066): print jobs and the print station on the branch topic, a toast
 * for a new notification, presence on a deposit, and the link-QR sheet following the deposit's own
 * broadcast. Nothing here reaches LINE or a printer (the fixture branch has neither).
 */
test.describe.configure({ mode: 'serial' })

const as = (role: string) => join(AUTH_DIR, `${role}.json`)

async function waitLive(page: Page) {
  await expect(page.locator('[data-live="joined"]')).toHaveCount(1, { timeout: 20_000 })
}

test.afterAll(async () => {
  await adminDb().from('print_jobs').delete().eq('branch_id', fixtureIds().branchA).like('payload->>deposit_code', 'DEP-%').gte('created_at', new Date(Date.now() - 3600_000).toISOString())
  await cleanupRun()
})

test.describe('owner', () => {
  test.use({ storageState: as('owner') })

  test('P4-11-01 a new print job shows in the jobs list at once; one that fails says so in a toast', async ({ page, context }) => {
    await context.addCookies([{ name: 'sis_branch', value: fixtureIds().branchA, url: BASE_URL }])
    const dep = await mustCreate('staff', { qty: 1 })
    await page.goto('/settings/branch')
    await waitLive(page)
    const rows = page.getByTestId('print-jobs-desktop').getByTestId('print-job-row')
    const before = await rows.count()

    const { data: job, error } = await dbAs('owner').rpc('queue_print', { p_deposit: dep.id, p_type: 'label' })
    expect(error, error?.message).toBeNull()
    await expect(rows).toHaveCount(Math.min(before + 1, 20), { timeout: 10_000 })

    const id = (job as { id: string }).id
    await adminDb().from('print_jobs').update({ status: 'failed', error_message: 'e2e' }).eq('id', id)
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `พิมพ์ไม่สำเร็จ · ${dep.code}` })).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('bar', () => {
  test.use({ storageState: as('bar') })

  test('P4-11-02 new work waits in a stack shown only when the person is free; it stays until opened or closed and leaves when done elsewhere (R-078)', async ({ page }) => {
    await page.goto('/tonight')
    await waitLive(page)
    // busy: the bell sheet is open — the work queues
    await page.getByTestId('bell-button').first().click()
    const { data, error } = await createDeposit('staff', { qty: 1 })
    expect(error, error?.message).toBeNull()
    await expect(page.locator('[data-testid="bell-item"][data-kind="deposit_received"]').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(4000)
    await expect(page.getByTestId('work-stack')).toHaveCount(0)
    // free: the sheet closed and nothing touched for 3 s — it shows, and stays
    await page.keyboard.press('Escape')
    const stack = page.getByTestId('work-stack')
    await expect(stack).toBeVisible({ timeout: 15_000 })
    await expect(stack.getByTestId('work-stack-top')).toHaveAttribute('data-kind', 'deposit_received')
    await expect(stack.getByTestId('work-stack-top')).toContainText('เหล้ารอยืนยัน')
    await expect(stack.getByTestId('work-stack-top')).toContainText(/โต๊ะ A3/)
    await page.waitForTimeout(7000)
    await expect(stack).toBeVisible()

    // a second one: the newest on top, "+1" opens the rest
    const second = await createDeposit('staff', { qty: 1 })
    expect(second.error, second.error?.message).toBeNull()
    await expect(stack).toHaveAttribute('data-count', '2', { timeout: 15_000 })
    await stack.getByTestId('work-stack-more').click()
    await expect(stack.getByTestId('work-stack-row')).toHaveCount(1)

    // done elsewhere → it leaves by itself
    const { data: bottles } = await adminDb().from('deposit_bottles').select('id').eq('deposit_id', second.data!.id)
    const { data: pic } = await adminDb().from('deposits').select('photo_paths').eq('id', second.data!.id).single()
    const { error: cErr } = await dbAs('owner').rpc('confirm_deposit', { p_deposit: second.data!.id, p_levels: (bottles ?? []).map(() => 100), p_photo_paths: pic!.photo_paths })
    expect(cErr, cErr?.message).toBeNull()
    await expect(stack).toHaveAttribute('data-count', '1', { timeout: 15_000 })

    // เปิด opens it and takes it off the stack (read)
    await stack.getByTestId('work-stack-open').click()
    await page.waitForURL(new RegExp(`/deposits/${data!.id}`))
    await expect(page.getByTestId('work-stack')).toHaveCount(0)

    // the chime: off until turned on, and it stays on for this device
    await page.getByTestId('bell-button').first().click()
    const sw = page.getByTestId('bell-sound-switch')
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(await page.evaluate(() => localStorage.getItem('sis_alert_sound'))).toBe('on')
  })
})

test('P4-11-03 two people on one deposit each see the other has it open', async ({ browser }) => {
  const dep = await mustCreate('staff', { qty: 1 })
  await confirmAll(dep.id, [100])
  const staff = await browser.newContext({ storageState: as('staff') })
  const bar = await browser.newContext({ storageState: as('bar') })
  try {
    const a = await staff.newPage()
    const b = await bar.newPage()
    await a.goto(`/deposits/${dep.id}`)
    await b.goto(`/deposits/${dep.id}`)
    await waitLive(a)
    await waitLive(b)
    const { data: names } = await adminDb().from('profiles').select('id, display_name, username').in('id', [fixtureIds().users.staff, fixtureIds().users.bar])
    const nameOf = (id: string) => {
      const p = names!.find((x) => x.id === id)!
      return p.display_name || p.username
    }
    await expect(a.getByTestId('deposit-viewers')).toContainText(nameOf(fixtureIds().users.bar), { timeout: 15_000 })
    await expect(b.getByTestId('deposit-viewers')).toContainText(nameOf(fixtureIds().users.staff), { timeout: 15_000 })

    // the other leaves: the note goes
    await b.goto('/tonight')
    await expect(a.getByTestId('deposit-viewers')).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await staff.close()
    await bar.close()
  }
})
