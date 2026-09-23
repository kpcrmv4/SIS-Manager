import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { adminDb, dbAs, fixtureIds } from './fixtures/db'
import { AUTH_DIR, BASE_URL } from './fixtures/env'
import { mustCreate, cleanupRun } from './fixtures/deposits'
import { cleanupPrintStation, failPrintJob, markStationOffline, markStationOnline, resetPrintFields, setLineBotUserId } from './fixtures/p3b-print'
import { BRANCH_A_NAME } from './fixtures/users'

// Playwright compiles specs to CommonJS, so the print-server's CommonJS module loads with require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HtmlRenderer = require(resolve('print-server/lib/html-renderer.js')) as new (
  s: Record<string, unknown>,
  name: string,
  width: number,
) => { renderForPrint(job: { job_type: string; copies: number; payload: Record<string, unknown> }): string[] }

const as = (role: string) => join(AUTH_DIR, `${role}.json`)
const admin = () => adminDb()

test.describe.configure({ mode: 'serial' })

let branchA = ''

test.afterAll(async () => {
  await cleanupRun()
  await cleanupPrintStation(admin(), branchA)
  await resetPrintFields(admin(), branchA)
})

test.beforeAll(async () => {
  branchA = fixtureIds().branchA
})

test.describe('P3-B1-02/03 print-server renderer', () => {
  const payload = {
    deposit_code: 'DEP-RMI-9K3ZZ',
    link_code: 'Z3K9RM',
    customer_name: '<b>ทดสอบ</b>',
    customer_phone: '081',
    product_name: 'Johnnie "Black"',
    quantity: 1,
    remaining_qty: 1,
    table_number: 'B2',
    created_at: '2026-09-23T13:05:00Z',
    expiry_date: '2026-10-23T13:05:00Z',
    received_by_name: 'staff',
  }

  test('P3-B1-02 receipt: link code, LINE OA QR when show_qr, header/footer, payload escaped — never the DEP-code QR', () => {
    const r = new HtmlRenderer({ show_qr: true, qr_code_image_url: 'data:image/png;base64,AAAA', line_oa_id: '@sis', header: 'SIS Music Bar', footer: 'ใบนี้ใช้แทนบัตรสมาชิก' }, 'SIS', 80)
    const html = r.renderForPrint({ job_type: 'receipt', copies: 1, payload }).join('')
    expect(html).toContain('Type <b>Z3K9RM</b> in chat')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('SIS Music Bar')
    expect(html).toContain('ใบนี้ใช้แทนบัตรสมาชิก')
    expect(html).not.toContain('<b>ทดสอบ</b>')
    expect(html).toContain('&lt;b&gt;ทดสอบ&lt;/b&gt;')
    expect(html).toContain('Johnnie &quot;Black&quot;')
    // the receipt never carries a QR encoding the deposit itself
    expect(html).not.toContain('data:image/svg+xml')
  })

  test('P3-B1-03 label: QR encodes the DEP code (staff scan on /scan), never the link code', () => {
    const r = new HtmlRenderer({}, 'SIS', 80)
    const html = r.renderForPrint({ job_type: 'label', copies: 1, payload }).join('')
    expect(html).toContain('data:image/svg+xml;base64,')
    expect(html).not.toContain('Z3K9RM')
    expect(html).toContain('DEP-RMI-9K3ZZ')
  })
})

test.describe('P3-B1-01 print buttons queue a job', () => {
  test.use({ storageState: as('staff') })

  test('P3-B1-01 receipt carries the link code, label never does', async ({ page }) => {
    const created = await mustCreate('staff')
    await page.goto(`/deposits/${created.id}`)
    await expect(page.getByTestId('print-receipt')).toBeVisible()

    const jobCount = async () => {
      const { count } = await admin().from('print_jobs').select('id', { count: 'exact', head: true }).eq('deposit_id', created.id)
      return count ?? 0
    }

    // both buttons show the identical toast text, so waiting on the toast alone cannot tell
    // the two clicks apart — poll the row count instead, which is what actually matters.
    // print-server not running: the confirm dialog warns before anything is queued
    await markStationOffline(admin(), branchA)
    await page.getByTestId('print-receipt').click()
    await expect(page.getByTestId('print-offline-warning')).toBeVisible()
    expect(await jobCount()).toBe(0)
    await page.getByTestId('print-confirm').click()
    await expect.poll(jobCount, { message: 'receipt job queued' }).toBe(1)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // running: the dialog says it is ready, still asks to confirm; cancel queues nothing
    await markStationOnline(admin(), branchA)
    await page.getByTestId('print-label').click()
    await expect(page.getByTestId('print-ready')).toBeVisible()
    await expect(page.getByTestId('print-offline-warning')).toHaveCount(0)
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
    expect(await jobCount()).toBe(1)
    await page.getByTestId('print-label').click()
    await page.getByTestId('print-confirm').click()
    await expect.poll(jobCount, { message: 'label job queued' }).toBe(2)

    const { data: jobs, error } = await admin().from('print_jobs').select('job_type, status, payload').eq('deposit_id', created.id).order('created_at')
    expect(error, error?.message).toBeNull()
    expect(jobs).toHaveLength(2)
    const receipt = jobs!.find((j) => j.job_type === 'receipt')!
    const label = jobs!.find((j) => j.job_type === 'label')!
    expect(receipt.status).toBe('pending')
    expect((receipt.payload as { link_code?: string }).link_code).toBeTruthy()
    expect((receipt.payload as { deposit_code?: string }).deposit_code).toBe(created.code)
    expect(label.status).toBe('pending')
    expect((label.payload as { link_code?: string | null }).link_code ?? null).toBeNull()
  })
})

test.describe('P3-B1-07 top-bar printer indicator', () => {
  test.use({ storageState: as('staff') })

  test('P3-B1-07 the printer icon shows online / offline / not set up for the working branch', async ({ page }) => {
    await markStationOnline(admin(), branchA)
    await page.goto('/tonight')
    const icon = page.getByTestId('printer-indicator')
    await expect(icon).toHaveAttribute('data-state', 'online')
    await expect(icon).toHaveAttribute('aria-label', /ออนไลน์/)
    await markStationOffline(admin(), branchA)
    await page.reload()
    await expect(icon).toHaveAttribute('data-state', 'offline')
    await cleanupPrintStation(admin(), branchA)
    await page.reload()
    await expect(icon).toHaveAttribute('data-state', 'not_set_up')
  })
})

test.describe('P3-B1-04/05 print status + settings', () => {
  test.use({ storageState: as('owner') })

  test.beforeEach(async ({ page, context }) => {
    const ownerId = fixtureIds().users.owner
    await admin().from('profiles').update({ active: true }).eq('id', ownerId)
    await context.addCookies([{ name: 'sis_branch', value: branchA, url: BASE_URL }])
    await page.goto('/tonight')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(BRANCH_A_NAME)
  })

  test('P3-B1-04a not set up / online / offline', async ({ page }) => {
    await cleanupPrintStation(admin(), branchA)
    await page.goto('/settings/branch')
    const badge = page.getByTestId('print-status-badge')
    await expect(badge).toHaveAttribute('data-state', 'not_set_up')

    await markStationOnline(admin(), branchA)
    await page.getByTestId('print-status-refresh').click()
    await expect(badge).toHaveAttribute('data-state', 'online')

    await markStationOffline(admin(), branchA)
    await page.getByTestId('print-status-refresh').click()
    await expect(badge).toHaveAttribute('data-state', 'offline')
  })

  test('P3-B1-04b failed job shows พิมพ์ใหม่ and requeues', async ({ page }) => {
    const created = await mustCreate('owner')
    const { data: job, error } = await dbAs('owner').rpc('queue_print', { p_deposit: created.id, p_type: 'label' })
    expect(error, error?.message).toBeNull()
    await failPrintJob(admin(), (job as { id: string }).id)

    await page.goto('/settings/branch')
    const row = page.getByTestId('print-job-row').filter({ hasText: created.code })
    await expect(row.first()).toBeVisible()
    await row.first().getByTestId('print-job-retry').click()
    await expect(page.getByText('ส่งเข้าคิวพิมพ์แล้ว')).toBeVisible()

    const { data: after } = await admin().from('print_jobs').select('status').eq('deposit_id', created.id).order('created_at')
    expect(after!.some((j) => j.status === 'pending')).toBe(true)
  })

  test('P3-B1-05 receipt QR requires a LINE OA id; working hours + printer name persist', async ({ page }) => {
    await setLineBotUserId(admin(), branchA, null)
    await page.goto('/settings/branch')
    await expect(page.getByTestId('print-show-qr')).toBeDisabled()
    await expect(page.getByText('ต้องตั้งค่า LINE OA ของสาขาก่อน (ตั้งค่า > LINE)')).toBeVisible()

    await setLineBotUserId(admin(), branchA, 'Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
    await page.reload()
    await page.getByTestId('print-show-qr').click()
    await page.getByTestId('print-hours-enabled').click()
    await page.locator('#ps-start').fill('13:30')
    await page.locator('#ps-end').fill('05:45')
    await page.locator('#ps-printer').fill('POS58')
    await page.getByTestId('print-settings-save').click()
    await expect(page.getByText('บันทึกแล้ว')).toBeVisible()
    await expect(page.getByTestId('print-qr-preview')).toBeVisible()

    const { data, error } = await admin()
      .from('branches')
      .select('receipt_settings, print_server_working_hours, print_server_printer_name')
      .eq('id', branchA)
      .single()
    expect(error, error?.message).toBeNull()
    const receipt = data!.receipt_settings as { show_qr?: boolean; qr_code_image_url?: string }
    expect(receipt.show_qr).toBe(true)
    expect(receipt.qr_code_image_url).toMatch(/^data:image\/png;base64,/)
    expect(data!.print_server_working_hours).toMatchObject({ enabled: true, startHour: 13, startMinute: 30, endHour: 5, endMinute: 45 })
    expect(data!.print_server_printer_name).toBe('POS58')

    await resetPrintFields(admin(), branchA)
  })
})
