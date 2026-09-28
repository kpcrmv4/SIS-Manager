/**
 * Radix moves focus to the first field when a dialog opens — on a phone that pops the keyboard up
 * over half the sheet before the person has read it (owner, 2026-09-28). Every dialog and sheet
 * passes this as onOpenAutoFocus instead: focus goes to the dialog itself (Radix's focus scope is
 * focusable), so the focus trap, Esc and screen readers still work, and the keyboard waits for a tap.
 */
export function focusDialogItself(e: Event): void {
  e.preventDefault()
  const el = e.currentTarget as HTMLElement | null
  el?.focus({ preventScroll: true })
}
