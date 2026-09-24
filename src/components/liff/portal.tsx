'use client'

import { createContext, useContext } from 'react'

/**
 * The LIFF root element. Dialogs and sheets portal INTO it rather than into <body>, so they
 * carry the customer's theme (night / cream), the tokens and the lang of the page — and none
 * of the page-only styles (R-035). Null until the shell has mounted; Radix then falls back to
 * <body>, which only happens before any overlay can be opened.
 */
export const CxPortalContext = createContext<HTMLElement | null>(null)

export function useCxPortal(): HTMLElement | null {
  return useContext(CxPortalContext)
}
