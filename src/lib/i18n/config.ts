export const STAFF_LOCALES = ['th', 'en'] as const
export type StaffLocale = (typeof STAFF_LOCALES)[number]

export const CUSTOMER_LOCALES = ['th', 'en', 'zh', 'ko'] as const
export type CustomerLocale = (typeof CUSTOMER_LOCALES)[number]

export const DEFAULT_LOCALE = 'th' as const

/** Staff UI language — mirrors profiles.locale, set at login and on the account page. */
export const STAFF_LOCALE_COOKIE = 'sis_locale'
/** Customer (LIFF) language — mirrors customers.locale. */
export const CUSTOMER_LOCALE_COOKIE = 'sis_cx_locale'

export function isStaffLocale(v: unknown): v is StaffLocale {
  return typeof v === 'string' && (STAFF_LOCALES as readonly string[]).includes(v)
}

export function isCustomerLocale(v: unknown): v is CustomerLocale {
  return typeof v === 'string' && (CUSTOMER_LOCALES as readonly string[]).includes(v)
}

/** LIFF's liff.getLanguage() returns BCP-47 ("zh-TW", "ko-KR"); map to a supported locale. */
export function customerLocaleFrom(tag: string | null | undefined): CustomerLocale {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0]
  return isCustomerLocale(base) ? base : DEFAULT_LOCALE
}
