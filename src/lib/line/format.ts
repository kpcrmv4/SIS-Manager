import { TIME_ZONE } from '../constants'
import type { LineLocale } from './catalog'

/**
 * Text helpers for LINE messages. Every value that came from a payload (customer names,
 * item names, reasons) goes through `clip` before it is placed in a message, and templates
 * are filled in ONE pass — a value containing "{code}" stays literal text, it is never
 * expanded again (no template injection).
 */

/** Cut to `max` code points (an emoji or Thai combining mark is never split in half). */
export function clip(value: unknown, max: number): string {
  if (value === null || value === undefined) return ''
  const s = String(value).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').trim()
  const chars = Array.from(s)
  if (chars.length <= max) return s
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}

export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => (key in vars ? String(vars[key]) : ''))
}

/** A whole number from a payload value, or '' (so "{count}" never renders as NaN). */
export function int(value: unknown): string {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? String(Math.trunc(n)) : ''
}

const INTL: Record<LineLocale, string> = {
  th: 'th-TH-u-ca-buddhist',
  en: 'en-GB',
  zh: 'zh-CN',
  ko: 'ko-KR',
}

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  // a bare business night (YYYY-MM-DD) is a Bangkok calendar day — pin it to Bangkok noon
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00+07:00`) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 24 ต.ค. 2569 · 24 Oct 2026 · 2026年10月24日 · 2026. 10. 24. — Bangkok time, พ.ศ. only in Thai. */
export function lineDate(v: unknown, locale: LineLocale): string {
  const d = toDate(v)
  if (!d) return ''
  return new Intl.DateTimeFormat(INTL[locale], { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

/** 04:00 — 24-hour Bangkok wall clock. */
export function lineTime(v: unknown): string {
  const d = toDate(v)
  if (!d) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
}

export function lineDateTime(v: unknown, locale: LineLocale): string {
  const date = lineDate(v, locale)
  return date ? `${date} ${lineTime(v)}` : ''
}

const bangkokDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

/** Whole Bangkok calendar days from `now` to `v` (0 = the same day), or null for a bad date. */
export function daysUntilBangkok(v: unknown, now: Date = new Date()): number | null {
  const d = toDate(v)
  if (!d) return null
  return Math.round((Date.parse(`${bangkokDay(d)}T00:00:00Z`) - Date.parse(`${bangkokDay(now)}T00:00:00Z`)) / 86_400_000)
}

/** "HH:MM" or "HH:MM:SS" slot text → "HH:MM", anything else → ''. */
export function slotTime(v: unknown): string {
  return typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : ''
}
