// LINE message strings, loaded server-side from the same catalogs the apps use (CLAUDE.md §3):
// customer messages from messages/customer/<locale>.json `line.*`, staff-group messages from
// messages/staff/th.json `settingsLine.messages.*`. No 'server-only' here so the renderer can be
// imported by the Playwright specs; nothing in this file reads env or secrets.
// Relative imports (not '@/') so Node can load this outside the Next bundler.
import cxTh from '../../../messages/customer/th.json'
import cxEn from '../../../messages/customer/en.json'
import cxZh from '../../../messages/customer/zh.json'
import cxKo from '../../../messages/customer/ko.json'
import staffTh from '../../../messages/staff/th.json'

export type LineLocale = 'th' | 'en' | 'zh' | 'ko'

export type CustomerLine = (typeof cxTh)['line']
export type StaffLine = (typeof staffTh)['settingsLine']['messages']

const CUSTOMER: Record<LineLocale, CustomerLine> = {
  th: cxTh.line,
  en: cxEn.line,
  zh: cxZh.line,
  ko: cxKo.line,
}

export function isLineLocale(v: unknown): v is LineLocale {
  return v === 'th' || v === 'en' || v === 'zh' || v === 'ko'
}

/** The `line` block for a customer locale; anything unknown falls back to Thai. */
export function customerLine(locale: unknown): CustomerLine {
  return CUSTOMER[isLineLocale(locale) ? locale : 'th']
}

/** The default wording of the expiry reminder in every LIFF language (R-044) — what a branch starts from. */
export function expiryReminderDefaults(): Record<LineLocale, string> {
  return { th: CUSTOMER.th.expiryReminder, en: CUSTOMER.en.expiryReminder, zh: CUSTOMER.zh.expiryReminder, ko: CUSTOMER.ko.expiryReminder }
}

/** Staff-group messages are always Thai (DESIGN.md: the staff group is one Thai chat per branch). */
export function staffLine(): StaffLine {
  return staffTh.settingsLine.messages
}
