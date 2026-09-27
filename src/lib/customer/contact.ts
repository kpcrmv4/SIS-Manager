import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * R-065 · what a LIFF form fills in for this customer: the name and phone they last gave, else the ones
 * on their latest deposit or booking at any branch, else their LINE name. Service role — called only
 * after requireCustomer proved who is asking, and only ever for that customer.
 */
export type CustomerContact = { name: string; phone: string }

const PHONE_RE = /^[0-9+\- ]{6,20}$/

export async function customerContact(customerId: string, lineName: string | null): Promise<CustomerContact> {
  const admin = getSupabaseAdmin()
  const [{ data: c }, { data: dep }, { data: bk }] = await Promise.all([
    admin.from('customers').select('contact_name, phone').eq('id', customerId).maybeSingle(),
    admin.from('deposits').select('customer_name, customer_phone, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 0),
    admin.from('bookings').select('name, phone, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 0),
  ])
  const d = dep?.[0]
  const b = bk?.[0]
  const latest = d && b ? (d.created_at > b.created_at ? { name: d.customer_name, phone: d.customer_phone } : { name: b.name, phone: b.phone }) : d ? { name: d.customer_name, phone: d.customer_phone } : b ? { name: b.name, phone: b.phone } : null
  return {
    name: c?.contact_name ?? latest?.name ?? lineName ?? '',
    phone: c?.phone ?? latest?.phone ?? '',
  }
}

/** Keep what the customer just sent as their contact for next time; a bad phone is left out, never an error. */
export async function rememberContact(customerId: string, name: string | undefined, phone: string | undefined): Promise<void> {
  const patch: { contact_name?: string; phone?: string | null } = {}
  const n = name?.trim().slice(0, 120)
  if (n) patch.contact_name = n
  const p = phone?.trim()
  if (p !== undefined) patch.phone = p === '' ? null : PHONE_RE.test(p) ? p : undefined
  if (patch.phone === undefined) delete patch.phone
  if (!Object.keys(patch).length) return
  // a stale contact is cosmetic: the request itself already went through
  await getSupabaseAdmin().from('customers').update(patch).eq('id', customerId)
}
