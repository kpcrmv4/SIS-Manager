'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

/** A `<tr>` cannot be a `<Link>` — this makes a desktop table row clickable, matching the demo's `tr.click`. */
export function RowLink({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  const router = useRouter()
  return (
    <tr
      className="click"
      tabIndex={0}
      role="link"
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(href)
      }}
      data-testid={testId}
    >
      {children}
    </tr>
  )
}
