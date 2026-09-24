import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { CUSTOMER_PAGE, HISTORY_PAGE, type CustomerDetail, type CustomerFilter, type CustomerList } from './view'

/**
 * Reads for the customers pages (R-048). A failed read throws, so the route's error boundary
 * renders the retry card; "no such customer" is null, so the page can 404.
 */

export async function listCustomers(branchId: string, filter: CustomerFilter, q: string, page: number): Promise<CustomerList> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('customer_list', {
    p_branch: branchId,
    p_q: q || undefined,
    p_filter: filter,
    p_limit: CUSTOMER_PAGE,
    p_offset: (Math.max(page, 1) - 1) * CUSTOMER_PAGE,
  })
  if (error) throw new Error(`customer_list: ${error.message}`)
  return data as unknown as CustomerList
}

export async function getCustomer(branchId: string, key: string, depositPage: number, bookingPage: number): Promise<CustomerDetail | null> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('customer_detail', {
    p_branch: branchId,
    p_key: key,
    p_dep_offset: (Math.max(depositPage, 1) - 1) * HISTORY_PAGE,
    p_bk_offset: (Math.max(bookingPage, 1) - 1) * HISTORY_PAGE,
    p_page: HISTORY_PAGE,
  })
  if (error) throw new Error(`customer_detail: ${error.message}`)
  return (data as unknown as CustomerDetail | null) ?? null
}
