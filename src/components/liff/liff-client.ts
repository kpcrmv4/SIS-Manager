'use client'

/**
 * Thin wrapper around @line/liff (CLAUDE.md §1 customers / P2-C1). Only this file
 * touches the LIFF SDK — the shell decides what to do with the result, including
 * the NODE_ENV test double that skips this module entirely in non-production runs.
 */

export type LiffReady = { ok: true; accessToken: string; language: string }
export type LiffNotReady = { ok: false; reason: 'need_line' | 'login_failed' }
export type LiffResult = LiffReady | LiffNotReady

/**
 * Initialise LIFF, sign the customer in if needed, and return a fresh LINE access
 * token + the device language. `liff.login()` navigates away (LINE login flow),
 * so a 'login_failed' return right after it just means "nothing left to render
 * this tick" — the real outcome arrives on the redirect back.
 */
export async function initLiff(liffId: string): Promise<LiffResult> {
  const { default: liff } = await import('@line/liff')
  let inClient = false
  try {
    inClient = liff.isInClient()
  } catch {
    inClient = false
  }
  try {
    await liff.init({ liffId })
  } catch {
    return { ok: false, reason: inClient ? 'login_failed' : 'need_line' }
  }
  try {
    if (!liff.isLoggedIn()) {
      liff.login()
      return { ok: false, reason: 'login_failed' }
    }
    const accessToken = liff.getAccessToken()
    if (!accessToken) return { ok: false, reason: 'login_failed' }
    const language = liff.getLanguage() ?? 'th'
    return { ok: true, accessToken, language }
  } catch {
    return { ok: false, reason: 'login_failed' }
  }
}

/** Deep link that opens this LIFF app inside the real LINE client. */
export function liffOpenUrl(liffId: string): string {
  return `https://liff.line.me/${liffId}`
}
