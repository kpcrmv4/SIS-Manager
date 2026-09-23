'use client'

import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

/**
 * Bottom sheet on a phone, centred dialog at `nav:` (≥860px) — the one shape
 * every booking dialog in this feature uses (รับจอง form, confirm+assign,
 * reject, the booking detail sheet). See more-sheet.tsx for the sibling
 * pattern used by the app-wide "เพิ่มเติม" sheet.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  children,
  width = 460,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: ReactNode
  width?: number
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          style={{ ['--dlg-w' as string]: `${width}px` }}
          className="fixed inset-x-0 bottom-0 z-31 max-h-[88vh] overflow-auto rounded-t-[20px] bg-card px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-2 text-ink shadow-[0_-8px_30px_rgba(0,0,0,.25)] nav:inset-x-auto nav:bottom-auto nav:left-1/2 nav:top-1/2 nav:w-[var(--dlg-w)] nav:max-w-[92vw] nav:-translate-x-1/2 nav:-translate-y-1/2 nav:rounded-[16px] nav:p-5 nav:shadow-e2"
        >
          <div className="mx-auto mb-3 mt-1 h-1 w-10 rounded-sm bg-line nav:hidden" aria-hidden />
          <Dialog.Title className="mb-3 text-base font-semibold text-ink">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
