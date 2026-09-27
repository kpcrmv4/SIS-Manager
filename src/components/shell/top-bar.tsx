'use client'

import type { BranchRef } from '@/lib/auth/actor'
import { BellButton } from './bell'
import { BranchSwitcher } from './branch-switcher'
import { PrinterIndicator } from './printer-indicator'
import { ThemeToggle } from './theme-toggle'

// framed circles: every button in the app has a visible edge (R-035)
const ICON_BTN =
  'flex size-10 items-center justify-center rounded-full border border-line bg-card text-muted-token transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

/**
 * Global controls on every staff page: on a phone the working branch sits top-left — a picker when
 * the person has several (owner, 2026-09-27); the sidebar carries it from `nav:` up. Then printer
 * status · notifications · theme on the right.
 */
export function TopBar({ userId, branches, branch, owner }: { userId: string; branches: BranchRef[]; branch: BranchRef | null; owner: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-2 nav:justify-end nav:px-5 nav:pt-3" data-testid="top-bar">
      <div className="min-w-0 flex-1 nav:hidden">{branch && <BranchSwitcher branches={branches} branch={branch} variant="top" />}</div>
      <div className="flex flex-none items-center gap-1">
        {branch && <PrinterIndicator key={branch.id} branchId={branch.id} className={ICON_BTN} owner={owner} />}
        <BellButton userId={userId} className={ICON_BTN} showLabel={false} />
        <ThemeToggle className={ICON_BTN} showLabel={false} />
      </div>
    </div>
  )
}
