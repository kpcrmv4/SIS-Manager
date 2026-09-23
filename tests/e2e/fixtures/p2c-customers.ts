import { randomBytes } from 'node:crypto'
import { expect } from '@playwright/test'
import { adminDb } from './db'
import type { CustomerLocale } from '../../../src/lib/i18n/config'

/** Every customer a P2-C spec creates carries this run tag in display_name; afterAll deletes by it. */
export const RUN = `E2EC-${Date.now().toString(36)}`

function lineUserId(): string {
  return `U${randomBytes(16).toString('hex')}`
}

export async function makeCustomer(opts: { locale?: CustomerLocale; name?: string } = {}) {
  const { data, error } = await adminDb()
    .from('customers')
    .insert({ line_user_id: lineUserId(), display_name: opts.name ?? `${RUN} customer`, locale: opts.locale ?? 'th' })
    .select('id, line_user_id, locale, display_name')
    .single()
  expect(error, error?.message).toBeNull()
  return data!
}

export async function cleanupCustomers() {
  const admin = adminDb()
  const { data } = await admin.from('customers').select('id').like('display_name', `${RUN}%`).range(0, 999)
  const ids = (data ?? []).map((c) => c.id)
  if (ids.length) {
    await admin.from('bookings').delete().in('customer_id', ids)
    await admin.from('deposits').delete().in('customer_id', ids)
    await admin.from('customers').delete().in('id', ids)
  }
}
