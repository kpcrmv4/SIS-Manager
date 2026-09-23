import { getTranslations } from 'next-intl/server'

/**
 * Route skeleton for a screen not yet built (P2-C2/C3 replace this per route). Renders only
 * the body card — the header, tabs and session now live in <LiffShell> (P2-C1), which already
 * wraps every page under /liff/[branch].
 */
export async function LiffPlaceholder({ locale, body }: { locale: string; title?: string; body: string }) {
  const t = await getTranslations({ locale, namespace: 'cx' })
  return <div className="cx-card text-center text-sm text-cx-muted">{t(body)}</div>
}
