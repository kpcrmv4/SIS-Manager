'use client'

import { BellButton } from './bell'
import { PrinterIndicator } from './printer-indicator'
import { ThemeToggle } from './theme-toggle'

// framed circles: every button in the app has a visible edge (R-035)
const ICON_BTN =
  'flex size-10 items-center justify-center rounded-full border border-line bg-card text-muted-token transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

/** Global controls, top-right on every staff page: printer status · notifications · theme. */
export function TopBar({ userId, branchId, owner }: { userId: string; branchId: string | null; owner: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1 px-2 pt-2 nav:px-5 nav:pt-3" data-testid="top-bar">
      {branchId && <PrinterIndicator key={branchId} branchId={branchId} className={ICON_BTN} owner={owner} />}
      <BellButton userId={userId} className={ICON_BTN} showLabel={false} />
      <ThemeToggle className={ICON_BTN} showLabel={false} />
    </div>
  )
}
