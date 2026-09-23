import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { TIME_ZONE } from '@/lib/constants'
import {
  CUSTOMER_LOCALE_COOKIE,
  DEFAULT_LOCALE,
  STAFF_LOCALE_COOKIE,
  isCustomerLocale,
  isStaffLocale,
  type CustomerLocale,
  type StaffLocale,
} from './config'

const staffCatalogs: Record<StaffLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  th: () => import('../../../messages/staff/th.json'),
  en: () => import('../../../messages/staff/en.json'),
}

const customerCatalogs: Record<CustomerLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  th: () => import('../../../messages/customer/th.json'),
  en: () => import('../../../messages/customer/en.json'),
  zh: () => import('../../../messages/customer/zh.json'),
  ko: () => import('../../../messages/customer/ko.json'),
}

/**
 * One request config for both apps. Staff strings live at the root of the
 * message tree (t('deposits.title')); customer strings live under `cx`
 * (t('cx.bottles.title')).
 *
 * The request locale is the staff locale from the cookie. LIFF pages pass
 * their customer locale explicitly — getTranslations({ locale, namespace: 'cx' })
 * — which arrives here as `requestLocale`; zh/ko then fall back to Thai for
 * the (unused) staff half.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const explicit = await requestLocale
  const store = await cookies()
  const staffCookie = store.get(STAFF_LOCALE_COOKIE)?.value
  const cxCookie = store.get(CUSTOMER_LOCALE_COOKIE)?.value

  const locale = explicit && isCustomerLocale(explicit) ? explicit : isStaffLocale(staffCookie) ? staffCookie : DEFAULT_LOCALE
  const staffLocale: StaffLocale = isStaffLocale(locale) ? locale : DEFAULT_LOCALE
  const cxLocale: CustomerLocale = explicit && isCustomerLocale(explicit) ? explicit : isCustomerLocale(cxCookie) ? cxCookie : DEFAULT_LOCALE

  const [staff, cx] = await Promise.all([staffCatalogs[staffLocale](), customerCatalogs[cxLocale]()])

  return {
    locale,
    timeZone: TIME_ZONE,
    messages: { ...staff.default, cx: cx.default },
  }
})
