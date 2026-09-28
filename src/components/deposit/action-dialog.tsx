'use client'

import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { focusDialogItself } from '@/lib/dialog-focus'

/**
 * The one dialog shell every deposit action (confirm / reject / withdraw / extend / VIP /
 * dispose / receive) is built on. Bottom sheet on a phone, centred panel from `nav:` up —
 * never a centred dialog on phones (CLAUDE.md §3). `components/ui` has no dialog primitive
 * yet, so this lives here; it is intentionally generic (title/description/children/footer)
 * so it does not become a second copy per screen.
 */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content onOpenAutoFocus={focusDialogItself}
          {...(!description && { 'aria-describedby': undefined })}
          className="fixed inset-x-0 bottom-0 z-41 flex max-h-[88vh] flex-col overflow-hidden rounded-t-[20px] bg-card text-ink shadow-[0_-8px_30px_rgba(0,0,0,.25)] nav:inset-x-auto nav:bottom-auto nav:left-1/2 nav:top-1/2 nav:w-full nav:max-w-[440px] nav:-translate-x-1/2 nav:-translate-y-1/2 nav:rounded-[16px] nav:shadow-e2"
        >
          <div className="mx-auto mb-1 mt-2 h-1 w-10 shrink-0 rounded-sm bg-line nav:hidden" aria-hidden />
          <div className="overflow-y-auto px-5 pb-4 pt-3">
            <Dialog.Title className="text-lg font-bold text-ink">{title}</Dialog.Title>
            {description && <Dialog.Description className="mt-1 text-sm text-muted-token">{description}</Dialog.Description>}
            {children && <div className="mt-4">{children}</div>}
          </div>
          {footer && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5 pb-[calc(14px+env(safe-area-inset-bottom,0px))]">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
