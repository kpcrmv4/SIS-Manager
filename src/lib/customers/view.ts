import type { DepositStatus } from '@/lib/deposit/format'
import type { BookingStatus } from '@/lib/booking/format'

/**
 * The customers pages (R-048) — shapes of customer_list / customer_detail and the pure helpers
 * both pages and their tests share. No server-only imports.
 *
 * A customer is a LINE account, else a phone (digits only), else a name — keys 'c-<uuid>',
 * 'p-<digits>', 'n-<md5>'. A page opened with 'd-<deposit id>' or 'b-<booking id>' lands on the
 * customer of that deposit or booking.
 */

export const CUSTOMER_PAGE = 25
export const HISTORY_PAGE = 20

export type CustomerFilter = 'all' | 'in_store' | 'vip' | 'line'
export const CUSTOMER_FILTERS: CustomerFilter[] = ['all', 'in_store', 'vip', 'line']

export function parseCustomerFilter(raw: string | undefined): CustomerFilter {
  return (CUSTOMER_FILTERS as string[]).includes(raw ?? '') ? (raw as CustomerFilter) : 'all'
}

/** A customer's own key — what set_customer_vip takes. */
export const CUSTOMER_KEY = /^(c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|p-[0-9]{6,15}|n-[0-9a-f]{32})$/

/** Any key a customer page may be opened with. */
export const CUSTOMER_LOOKUP = /^([cdb]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|p-[0-9]{6,15}|n-[0-9a-f]{32})$/

export const customerHrefForDeposit = (depositId: string) => `/customers/d-${depositId}`
export const customerHrefForBooking = (bookingId: string) => `/customers/b-${bookingId}`

export type CustomerRow = {
  key: string
  name: string
  phone: string | null
  line: boolean
  line_name: string | null
  is_vip: boolean
  can_vip: boolean
  bottles_in_store: number
  deposits_in_store: number
  deposits: number
  bookings: number
  next_night: string | null
  last_at: string | null
}

export type CustomerList = {
  counts: Record<CustomerFilter, number>
  total: number
  rows: CustomerRow[]
}

export type CustomerDeposit = {
  id: string
  code: string
  item: string
  quantity: number
  remaining_qty: number
  remaining_percent: number
  status: DepositStatus
  is_vip: boolean
  expires_at: string | null
  created_at: string
  table: string | null
  name: string
}

export type CustomerBooking = {
  id: string
  code: string
  night: string
  time: string
  party: number
  status: BookingStatus
  source: 'line' | 'staff'
  zone: string | null
  table: string | null
  name: string
}

export type CustomerDetail = {
  key: string
  name: string
  names: string[]
  phones: string[]
  line: { name: string | null; picture: string | null; locale: string; reminders: boolean } | null
  can_vip: boolean
  vip: { since: string; by: string | null } | null
  stats: {
    bottles_in_store: number
    deposits_in_store: number
    deposits: number
    expired: number
    bottles_withdrawn: number
    bookings: number
    arrived: number
    no_show: number
    cancelled: number
    next_booking: { night: string; time: string; code: string; status: BookingStatus } | null
    first_at: string | null
    last_at: string | null
    /** deposits "make VIP" would turn VIP: not VIP yet, in store, waiting for bar or expired */
    to_vip: number
    /** deposits "cancel VIP" would count again: VIP, in store or waiting for bar */
    vip_deposits: number
  }
  deposits: { total: number; rows: CustomerDeposit[] }
  bookings: { total: number; rows: CustomerBooking[] }
}

/** A tel: link from a phone however it was typed. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
