'use client'

import { RotateCw } from 'lucide-react'

/** The four data states (CLAUDE.md §3), styled for the `.cx` scope. */

export function CxSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" data-testid="cx-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="cx-card animate-pulse">
          <div className="h-4 w-2/5 rounded bg-cx-card-2" />
          <div className="h-1.5 w-full rounded bg-cx-card-2" />
          <div className="h-3 w-3/5 rounded bg-cx-card-2" />
        </div>
      ))}
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
