import { TIME_ZONE } from './constants'

/**
 * Every date the app shows is Bangkok time (CLAUDE.md §7). Vercel and pg_cron
 * run in UTC, so nothing here may rely on the process time zone: each Intl
 * format carries `timeZone`, and "which night is it" is computed from Bangkok
 * wall-clock parts.
 *
 * Thai shows the Buddhist year (พ.ศ.); every other locale shows the Gregorian
 * year. `th-TH-u-ca-buddhist` does that inside Intl.
 */

export type AppLocale = 'th' | 'en' | 'zh' | 'ko'

const INTL_LOCALE: Record<AppLocale, string> = {
  th: 'th-TH-u-ca-buddhist',
  en: 'en-GB',
  zh: 'zh-CN',
  ko: 'ko-KR',
}

function fmt(locale: AppLocale, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? INTL_LOCALE.th, { timeZone: TIME_ZONE, ...opts })
}

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v)
}

/** 23 ก.ย. 69 · 23 Sep 2026 */
export function formatShortDate(v: Date | string | number, locale: AppLocale = 'th'): string {
  return fmt(locale, { day: 'numeric', month: 'short', year: locale === 'th' ? '2-digit' : 'numeric' }).format(toDate(v))
}

/** วันพุธที่ 23 ก.ย. 2569 · Wednesday 23 Sep 2026 */
export function formatLongDate(v: Date | string | number, locale: AppLocale = 'th'): string {
  const d = toDate(v)
  if (locale === 'th') {
    const wd = fmt('th', { weekday: 'long' }).format(d)
    const rest = fmt('th', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
    return `${wd}ที่ ${rest}`
  }
  return fmt(locale, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

/** 20:05 (24-hour in every locale) */
export function formatTime(v: Date | string | number, locale: AppLocale = 'th'): string {
  return fmt(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(toDate(v))
}

/** ตุลาคม 2569 · October 2026 */
export function formatMonthYear(v: Date | string | number, locale: AppLocale = 'th'): string {
  return fmt(locale, { month: 'long', year: 'numeric' }).format(toDate(v))
}

/** Bangkok wall-clock parts of an instant. */
export function bangkokParts(v: Date | string | number = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(toDate(v))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: get('weekday'),
  }
}

/** YYYY-MM-DD of the Bangkok calendar day an instant falls on. */
export function bangkokDate(v: Date | string | number = new Date()): string {
  const p = bangkokParts(v)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/**
 * The business night an instant belongs to: before 06:00 Bangkok counts as the
 * previous night (a 01:30 check-in belongs to last night). Same rule as the DB
 * function private.business_night().
 */
export const NIGHT_ROLLOVER_HOUR = 6
export function businessNight(v: Date | string | number = new Date()): string {
  const d = toDate(v)
  const p = bangkokParts(d)
  if (p.hour >= NIGHT_ROLLOVER_HOUR) return bangkokDate(d)
  return bangkokDate(new Date(d.getTime() - 24 * 60 * 60 * 1000))
}

/** Add whole days to a YYYY-MM-DD date string (calendar arithmetic, no TZ). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

/** Monday = 0 … Sunday = 6 for a YYYY-MM-DD date. */
export function weekdayIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** Whole days from the Bangkok "today" to a date/instant (negative = past). */
export function daysUntil(v: Date | string | number, now: Date = new Date()): number {
  const target = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bangkokDate(v)
  const [y1, m1, d1] = bangkokDate(now).split('-').map(Number)
  const [y2, m2, d2] = target.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}
