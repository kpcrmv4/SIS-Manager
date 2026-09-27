'use client'

import type { BranchRef } from '@/lib/auth/actor'
import { BellButton } from './bell'
import { BranchSwitcher } from './branch-switcher'
import { PrinterIndicator } from './printer-indicator'
import { ThemeToggle } from './theme-toggle'

// every button has a visible edge (R-035): on the phone's dark bar a faint fill, from nav: up a framed circle
const ICON_BTN =
  'flex size-10 items-center justify-center rounded-full bg-sidebar-hover text-sidebar-fg transition-colors hover:bg-sidebar-active-bg hover:text-sidebar-title focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent nav:border nav:border-line nav:bg-card nav:text-muted-token nav:hover:bg-surface-2 nav:hover:text-ink nav:focus-visible:outline-brand'

/**
 * Global controls on every staff page: on a phone the working branch sits top-left — a picker when
 * the person has several (owner, 2026-09-27); the sidebar carries it from `nav:` up. Then printer
 * status · notifications · theme on the right. On a phone it is a dark bar, sticky, in the sidebar's
 * colour — the bottom nav matches it, so the screen is framed top and bottom (owner, 2026-09-27).
 */
export function TopBar({ userId, branches, branch, owner }: { userId: string; branches: BranchRef[]; branch: BranchRef | null; owner: boolean }) {
  return (
    <div
      className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-sidebar-line bg-sidebar px-3 pt-[env(safe-area-inset-top,0px)] nav:static nav:h-auto nav:justify-end nav:border-0 nav:bg-transparent nav:px-5 nav:pt-3"
      data-testid="top-bar"
    >
      <div className="min-w-0 flex-1 nav:hidden">{branch && <BranchSwitcher branches={branches} branch={branch} variant="top" />}</div>
      <div className="flex flex-none items-center gap-1">
        {branch && <PrinterIndicator key={branch.id} branchId={branch.id} className={ICON_BTN} owner={owner} />}
        <BellButton userId={userId} className={ICON_BTN} showLabel={false} />
        <ThemeToggle className={ICON_BTN} showLabel={false} />
      </div>
    </div>
  )
}
