'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CalendarDays, Moon, RotateCw, Sun, Ticket as TicketIcon, Wine } from 'lucide-react'
import type { CustomerLocale } from '@/lib/i18n/config'
import { CUSTOMER_LOCALE_COOKIE } from '@/lib/i18n/config'
import { initLiff, liffOpenUrl } from './liff-client'
import { LocaleSheet } from './locale-sheet'
import { SessionProvider, clearStoredToken, readStoredToken, storeToken, type CxSession } from './session-context'

type Status = 'loading' | 'need_line' | 'login_failed' | 'ready'

declare global {
  interface Window {
    /** E2E test double (P2-C1) — dead in production. See CLAUDE.md customer rules. */
    __SIS_LIFF_TEST__?: { customerToken: string }
  }
}

const THEME_KEY = 'sis_cx_theme'

function titleFor(pathname: string, branchCode: string): { title: string; body?: string } {
  const rest = pathname.split(`/liff/${branchCode.toLowerCase()}`)[1] ?? ''
  if (rest.startsWith('/deposit')) return { title: 'depositRequest.title' }
  if (rest.startsWith('/book')) return { title: 'book.title' }
  if (rest.startsWith('/ticket/')) return { title: 'ticket.title' }
  if (rest.startsWith('/tickets')) return { title: 'ticket.list' }
  return { title: 'bottles.title' }
}

async function establishSession(
  branch: { code: string; liffId: string | null },
): Promise<{ status: 'ready'; session: CxSession } | { status: 'need_line' | 'login_failed' }> {
  const test = typeof window !== 'undefined' && process.env.NODE_ENV !== 'production' ? window.__SIS_LIFF_TEST__ : undefined

  const viaToken = async (token: string): Promise<{ status: 'ready'; session: CxSession } | null> => {
    try {
      const res = await fetch(`/api/customer/session?branch=${branch.code}`, {
        method: 'POST',
        headers: { 'X-Customer-Token': token, 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) return null
      const data = (await res.json()) as CxSession
      storeToken(branch.code, data.token)
      return { status: 'ready', session: data }
    } catch {
      return null
    }
  }

  if (test?.customerToken) {
    const hit = await viaToken(test.customerToken)
    if (hit) return hit
    return { status: 'login_failed' }
  }

  const stored = readStoredToken(branch.code)
  if (stored) {
    const hit = await viaToken(stored)
    if (hit) return hit
    clearStoredToken(branch.code)
  }

  if (!branch.liffId) return { status: 'login_failed' }
  const liff = await initLiff(branch.liffId)
  if (!liff.ok) return { status: liff.reason }

  try {
    const res = await fetch(`/api/customer/session?branch=${branch.code}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${liff.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: liff.language }),
    })
    if (!res.ok) return { status: 'login_failed' }
    const data = (await res.json()) as CxSession
    storeToken(branch.code, data.token)
    return { status: 'ready', session: data }
  } catch {
    return { status: 'login_failed' }
  }
}

/**
 * LIFF shell (P2-C1): establishes the customer session, then renders the header,
 * page content and the 3-slot bottom nav. Nothing under it ever renders without a
 * session — <SessionProvider> only wraps children once status is 'ready'.
 */
export function LiffShell({
  branch,
  locale,
  children,
}: {
  branch: { code: string; name: string; liffId: string | null }
  locale: CustomerLocale
  children: ReactNode
}) {
  const t = useTranslations('cx')
  const router = useRouter()
  const pathname = usePathname()
  const startedRef = useRef(false)
  const [status, setStatus] = useState<Status>('loading')
  const [session, setSession] = useState<CxSession | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  const start = () => {
    setStatus('loading')
    void establishSession(branch).then((r) => {
      if (r.status === 'ready') {
        setSession(r.session)
        setStatus('ready')
        // first-contact locale comes from liff.getLanguage(); sync the cookie once it disagrees
        if (r.session.customer.locale !== locale) {
          document.cookie = `${CUSTOMER_LOCALE_COOKIE}=${r.session.customer.locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
          router.refresh()
        }
      } else {
        setStatus(r.status)
      }
    })
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // The server always renders the dark default (it cannot read localStorage); a returning
    // customer who picked cream gets one extra render right after mount to restore it.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(THEME_KEY) === 'light') setTheme('light')
    } catch {
      // localStorage unavailable — Night Bar stays the default, which is correct anyway
    }
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // best effort
    }
  }

  const { title } = titleFor(pathname, branch.code)
  const tab = (href: string, Icon: typeof Wine, label: string) => {
    const active = href === `/liff/${branch.code.toLowerCase()}` ? pathname === href : pathname.startsWith(href)
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex flex-col items-center justify-center gap-0.5 text-[10.5px] ${active ? 'font-semibold text-cx-gold' : 'text-cx-muted'}`}
      >
        <Icon className="size-5" aria-hidden />
        <span>{label}</span>
      </Link>
    )
  }

  return (
    <div className="cx font-sans" lang={locale} data-branch={branch.code} data-cx-theme={theme === 'light' ? 'light' : undefined}>
      <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col pb-[calc(64px+env(safe-area-inset-bottom,0px))]">
        <header className="flex items-center gap-3 border-b border-cx-line px-4.5 pb-3 pt-4.5">
          <div
            className="grid size-[42px] flex-none place-items-center rounded-full border-[1.5px] border-cx-gold text-[14px] font-bold text-cx-gold"
            style={{ background: 'radial-gradient(circle at 30% 30%, var(--cx-logo-from), var(--cx-logo-to))' }}
            aria-hidden
          >
            SIS
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="cx-serif truncate text-[17px] font-semibold leading-tight">{t(title)}</h1>
            {/* the branch name alone — it already carries the shop's name */}
            <p className="truncate text-xs text-cx-muted" data-testid="cx-branch-name">
              {branch.name}
            </p>
          </div>
          {status === 'ready' && session && (
            <div className="flex flex-none items-center gap-1">
              {/* the language on screen, not the session's copy — that one is fixed at sign-in */}
              <LocaleSheet session={session} current={locale} />
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={t('shell.theme')}
                data-testid="cx-theme-toggle"
                className="grid size-9 place-items-center rounded-full text-cx-muted"
              >
                {theme === 'dark' ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
              </button>
            </div>
          )}
        </header>

        <main className="flex-1 px-4 py-4">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-cx-muted" data-testid="cx-loading">
              <RotateCw className="size-5 animate-spin text-cx-gold" aria-hidden />
              {t('shell.loading')}
            </div>
          )}
          {status === 'need_line' && (
            <div className="cx-card items-center gap-3 py-8 text-center" data-testid="cx-need-line">
              <p className="text-sm">{t('shell.openInLine')}</p>
              <p className="text-xs text-cx-muted">{t('shell.openInLineBody')}</p>
              {branch.liffId && (
                <a href={liffOpenUrl(branch.liffId)} className="cx-btn mt-2">
                  {t('shell.openInLine')}
                </a>
              )}
            </div>
          )}
          {status === 'login_failed' && (
            <div className="cx-card items-center gap-3 py-8 text-center" data-testid="cx-login-failed">
              <p className="text-sm">{t('shell.loginFailed')}</p>
              <button type="button" onClick={start} className="cx-btn mt-2">
                {t('shell.retry')}
              </button>
            </div>
          )}
          {status === 'ready' && session && <SessionProvider value={session}>{children}</SessionProvider>}
        </main>
      </div>

      {status === 'ready' && (
        <nav
          aria-label={t('nav.myBottles')}
          data-testid="cx-bottom-nav"
          className="fixed inset-x-0 bottom-0 z-20 mx-auto grid h-[calc(64px+env(safe-area-inset-bottom,0px))] max-w-[480px] grid-cols-3 border-t border-cx-line bg-cx-card pb-[env(safe-area-inset-bottom,0px)]"
        >
          {tab(`/liff/${branch.code.toLowerCase()}`, Wine, t('nav.myBottles'))}
          {tab(`/liff/${branch.code.toLowerCase()}/book`, CalendarDays, t('nav.book'))}
          {tab(`/liff/${branch.code.toLowerCase()}/tickets`, TicketIcon, t('nav.tickets'))}
        </nav>
      )}
    </div>
  )
}
