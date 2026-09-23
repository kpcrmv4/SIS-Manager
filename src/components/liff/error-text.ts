/**
 * Turns a `dbErrorCode()` result (or a client-side validation code) into catalog text under
 * `cx.errors.*`. Falls back to the generic message for any code that has no specific key yet —
 * belt-and-suspenders alongside adding the keys we know we need (CLAUDE.md security rule #4).
 */
export function errorText(
  t: (key: string, values?: Record<string, string | number | Date>) => string,
  code: string | undefined,
  values?: Record<string, string | number | Date>,
): string {
  if (!code) return t('shell.errorGeneric')
  try {
    return t(`errors.${code}`, values)
  } catch {
    return t('shell.errorGeneric')
  }
}
