import type { CustomerLocale } from '@/lib/i18n/config'

/** `branches.withdrawal_blocked_days` stores private.dow_name() output: Mon..Sun, Monday-first. */
const DB_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const FULL_DAY: Record<CustomerLocale, string[]> = {
  th: ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  ko: ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'],
}

/**
 * "ศุกร์และเสาร์" / "Friday and Saturday" / "周五和周六" / "금요일과 토요일" — used for
 * `terms.item2`'s `{blocked}` placeholder (the deposit-request terms, P2-C2).
 */
export function blockedDaysText(blocked: string[], locale: CustomerLocale): string {
  const names = blocked.map((d) => DB_ORDER.indexOf(d)).filter((i) => i >= 0).map((i) => FULL_DAY[locale][i])
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  const head = names.slice(0, -1)
  const tail = names[names.length - 1]
  if (locale === 'en') return `${head.join(', ')} and ${tail}`
  if (locale === 'zh') return `${head.join('、')}和${tail}`
  if (locale === 'ko') return `${head.join(', ')}과 ${tail}`
  return `${head.join('')}และ${tail}`
}
