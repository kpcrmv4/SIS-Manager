'use client'

import { RotateCw, Wine } from 'lucide-react'

/** The four data states (CLAUDE.md §3), styled for the `.cx` scope. */

/**
 * Loading (R-040): Davis's bottle loader where the staff app has a skeleton — two gold rings turn
 * against each other, the bottle breathes, a scan line sweeps and sparks blink. The label's dots
 * count up in CSS, so labels carry none. `sm` sits inside a form section.
 */
export function CxLoader({ label, size, testId = 'cx-skeleton' }: { label: string; size?: 'sm'; testId?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${size === 'sm' ? 'py-3' : 'min-h-[40dvh]'}`} role="status" data-testid={testId}>
      <div className={size === 'sm' ? 'cx-loader is-sm' : 'cx-loader'} aria-hidden>
        <i className="cx-loader-ring" />
        <i className="cx-loader-orbit" />
        <Wine className="cx-loader-icon" strokeWidth={1.5} />
        <i className="cx-loader-scan" />
        <span className="cx-loader-spark" />
        <span className="cx-loader-spark" />
        <span className="cx-loader-spark" />
        <span className="cx-loader-spark" />
      </div>
      <p className="cx-loader-text">{label}</p>
    </div>
  )
}

export function CxErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="cx-card items-center gap-3 py-8 text-center" data-testid="cx-error">
      <p className="text-sm">{message}</p>
      <button type="button" onClick={onRetry} className="cx-btn ghost mt-1 w-auto px-4">
        <RotateCw className="size-4" aria-hidden />
      </button>
    </div>
  )
}

export function CxEmpty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="cx-card items-center gap-1.5 py-10 text-center" data-testid="cx-empty">
      <p className="text-sm">{title}</p>
      {body && <p className="text-xs text-cx-muted">{body}</p>}
    </div>
  )
}
