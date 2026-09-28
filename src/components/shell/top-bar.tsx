'use client'

import { Suspense } from 'react'
import type { BranchRef } from '@/lib/auth/actor'
import { AiAssistant } from '@/components/ai/ai-assistant'
import { BellButton } from './bell'
import { BranchSwitcher } from './branch-switcher'
import { PrinterIndicator } from './printer-indicator'
import { ThemeToggle } from './theme-toggle'

// every button has a visible edge (R-035): on the phone's bar a soft fill, from nav: up a framed circle
const ICON_BTN =
  'flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted-token transition-colors hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand nav:border nav:border-line nav:bg-card nav:hover:bg-surface-2'

/**
 * Global controls on every staff page: on a phone the working branch sits top-left — a picker when
 * the person has several (owner, 2026-09-27); the sidebar carries it from `nav:` up. Then printer
 * status · notifications · theme on the right. On a phone it is a sticky bar in the card's colour with
 * a hairline, matching the bottom nav (owner, 2026-09-27 — a dark pair was too harsh on a light page).
 */
export function TopBar({
  userId,
  branches,
  branch,
  owner,
  ai = false,
  me,
}: {
  userId: string
  branches: BranchRef[]
  branch: BranchRef | null
  owner: boolean
  ai?: boolean
  me: { displayName: string; role: string }
}) {
  return (
    <div
      className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-line bg-card px-3 pt-[env(safe-area-inset-top,0px)] nav:static nav:h-auto nav:justify-end nav:border-0 nav:bg-transparent nav:px-5 nav:pt-3"
      data-testid="top-bar"
    >
      <div className="min-w-0 flex-1 nav:hidden">{branch && <BranchSwitcher branches={branches} branch={branch} variant="top" />}</div>
      <div className="flex flex-none items-center gap-1">
        {/* R-070: the assistant, where the owner turned it on for this role */}
        {ai && branch && (
          <Suspense fallback={null}>
            <AiAssistant className={ICON_BTN} branchName={branch.name} displayName={me.displayName} role={me.role} />
          </Suspense>
        )}
        {branch && <PrinterIndicator key={branch.id} branchId={branch.id} className={ICON_BTN} owner={owner} />}
        <BellButton userId={userId} className={ICON_BTN} showLabel={false} />
        <ThemeToggle className={ICON_BTN} showLabel={false} />
      </div>
    </div>
  )
}
