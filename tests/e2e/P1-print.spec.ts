import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * P1-OUT-11: Davis's print-server renderer (kept as-is, RULINGS R-021) fed a payload shaped
 * exactly like public.queue_print builds it. Escaping and the LINE link code are the only
 * SIS changes to the renderer.
 */
// Playwright compiles specs to CommonJS, so the print-server's CommonJS module loads with require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HtmlRenderer = require(resolve('print-server/lib/html-renderer.js')) as new (s: object, name: string, width: number) => {
  renderForPrint(job: { job_type: string; copies: number; payload: object }): string[]
}

test('P1-OUT-11 Davis renderer: receipt with link code, one label per bottle, payload text escaped', () => {
  const r = new HtmlRenderer({ show_qr: true, qr_code_image_url: 'https://example.com/qr.png', line_oa_id: '@sis' }, 'SIS', 80)
  const payload = {
    deposit_code: 'DEP-RMI-7K2QX', link_code: 'K7M2QX', customer_name: '<script>alert(1)</script>', customer_phone: '081',
    product_name: 'Johnnie "Black"', quantity: 2, remaining_qty: 2, table_number: 'A3', created_at: '2026-09-23T13:05:00Z',
    expiry_date: '2026-10-23T13:05:00Z', received_by_name: 'staff ปอ',
    bottles: [{ bottle_no: 1, remaining_percent: 100 }, { bottle_no: 2, remaining_percent: 60 }],
  }
  const receipt = r.renderForPrint({ job_type: 'receipt', copies: 1, payload })
  const labels = r.renderForPrint({ job_type: 'label', copies: 1, payload })
  expect(receipt).toHaveLength(1)
  expect(labels).toHaveLength(2)
  const html = receipt.join('')
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('Johnnie &quot;Black&quot;')
  expect(html).toContain('Type <b>K7M2QX</b> in chat')
  expect(html).toContain('DEP-RMI-7K2QX')
})
