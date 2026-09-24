// The wording of the expiry reminder (R-044): the owner writes it per language with {{name}}
// variables. Pure (no env, no catalogs, relative imports) so the LINE renderer, the settings
// form's preview and the specs share it.

export const EXPIRY_VARIABLES = ['day', 'item', 'code', 'date', 'deadline', 'branch'] as const
export type ExpiryVariable = (typeof EXPIRY_VARIABLES)[number]

export const EXPIRY_LOCALES = ['th', 'en', 'zh', 'ko'] as const
export type ExpiryLocale = (typeof EXPIRY_LOCALES)[number]

/** Longest wording per language, in characters. */
export const TEMPLATE_MAX = 500
/** At most three reminders, each 1–90 days before the expiry date. */
export const REMINDER_MAX = 3
export const REMINDER_DAY_MIN = 1
export const REMINDER_DAY_MAX = 90

const TOKEN = /\{\{\s*([A-Za-z_]+)\s*\}\}/g
const isVariable = (name: string): name is ExpiryVariable => (EXPIRY_VARIABLES as readonly string[]).includes(name)

/**
 * Fill {{day}} {{item}} {{code}} {{date}} {{deadline}} {{branch}} in ONE pass — a value that
 * itself contains "{{day}}" stays literal text. An unknown {{name}} is left as written.
 */
export function fillExpiryTemplate(template: string, values: Partial<Record<ExpiryVariable, string>>): string {
  return template.replace(TOKEN, (whole, name: string) => {
    const key = name.toLowerCase()
    return isVariable(key) ? (values[key] ?? '') : whole
  })
}

/** The {{names}} in a wording that are not variables, as written. */
export function unknownVariables(template: string): string[] {
  const out = new Set<string>()
  for (const m of template.matchAll(TOKEN)) if (!isVariable(m[1].toLowerCase())) out.add(m[1])
  return [...out]
}

/** Reminder days as the database keeps them: whole, 1–90, no repeats, the earliest reminder first. */
export function cleanReminderDays(days: unknown): number[] | null {
  if (!Array.isArray(days) || days.length < 1 || days.length > REMINDER_MAX) return null
  const out = days.map((d) => (typeof d === 'number' ? d : Number(d)))
  if (!out.every((d) => Number.isInteger(d) && d >= REMINDER_DAY_MIN && d <= REMINDER_DAY_MAX)) return null
  if (new Set(out).size !== out.length) return null
  return [...out].sort((a, b) => b - a)
}
