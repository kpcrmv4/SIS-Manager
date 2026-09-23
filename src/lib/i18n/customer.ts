import 'server-only'
import { cookies } from 'next/headers'
import { CUSTOMER_LOCALE_COOKIE, DEFAULT_LOCALE, isCustomerLocale, type CustomerLocale } from './config'

/** The LIFF customer's language (cookie set by the LIFF shell; mirrors customers.locale). */
export async function getCustomerLocale(): Promise<CustomerLocale> {
  const v = (await cookies()).get(CUSTOMER_LOCALE_COOKIE)?.value
  return isCustomerLocale(v) ? v : DEFAULT_LOCALE
}
