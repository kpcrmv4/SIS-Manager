'use client'

import { createContext, useContext } from 'react'
import type { CustomerLocale } from '@/lib/i18n/config'

/** The established customer session (P2-C1): everything a LIFF page needs to call the API. */
export type CxSession = {
  token: string
  customer: { id: string; display_name: string | null; locale: CustomerLocale }
  branch: { code: string; name: string }
}

const SessionContext = createContext<CxSession | null>(null)
export const SessionProvider = SessionContext.Provider

/** Every page under the LIFF shell renders only once a session exists, so this never returns null. */
export function useCxSession(): CxSession {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useCxSession: no session (page rendered outside <LiffShell>?)')
  return s
}

const tokenKey = (branchCode: string) => `sis_cx_token_${branchCode.toLowerCase()}`

export function readStoredToken(branchCode: string): string | null {
  try {
    return sessionStorage.getItem(tokenKey(branchCode))
  } catch {
    return null
  }
}

export function storeToken(branchCode: string, token: string): void {
  try {
    sessionStorage.setItem(tokenKey(branchCode), token)
  } catch {
    // sessionStorage can throw in a private tab — the session still works for this page load
  }
}

export function clearStoredToken(branchCode: string): void {
  try {
    sessionStorage.removeItem(tokenKey(branchCode))
  } catch {
    // best effort
  }
}

/** Every /api/customer/* call after the session exists carries X-Customer-Token. */
export function customerFetch(path: string, session: Pick<CxSession, 'token'>, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-Customer-Token', session.token)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers })
}
