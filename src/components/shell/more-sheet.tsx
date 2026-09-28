'use client'

import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'
import type { BranchRef } from '@/lib/auth/actor'
import { BranchSwitcher } from './branch-switcher'
import { logout } from './logout'
import type { NavItem, NavSection } from './nav'
import { focusDialogItself } from '@/lib/dialog-focus'

/** A square tile: icon above a two-line label. */
const TILE =
  'flex aspect-square min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface-2 p-2 text-center text-[12.5px] leading-tight text-ink transition-colors active:bg-line'

const HEADING: Partial<Record<NavSection, string>> = {
  catDaily: 'catDaily',
  catReports: 'moreOverview',
  catSettings: 'moreSettings',
  catAccount: 'catAccount',
}

/** The เพิ่มเติม bottom sheet — anchored to the bottom edge, never a centred dialog on phones. */
export function MoreSheet({
  open,
  onOpenChange,
  items,
  branches,
  branch,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  items: NavItem[]
  branches: BranchRef[]
  branch: BranchRef | null
}) {
  const t = useTranslations('nav')
  // catDaily: any daily page without a bottom-bar slot of its own
  const groups = (['catDaily', 'catReports', 'catSettings', 'catAccount'] as const).map((s) => ({
    section: s,
    items: items.filter((i) => i.section === s),
  }))

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/45" />
        <Dialog.Content onOpenAutoFocus={focusDialogItself}
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-31 max-h-[88vh] overflow-auto rounded-t-[20px] bg-card px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-2 text-ink shadow-[0_-8px_30px_rgba(0,0,0,.25)]"
        >
          <Dialog.Title className="sr-only">{t('more')}</Dialog.Title>
          <div className="mx-auto mb-3 mt-1 h-1 w-10 rounded-sm bg-line" aria-hidden />
          {branches.length > 1 && (
            <div className="mb-2">
              <BranchSwitcher branches={branches} branch={branch} variant="sheet" />
            </div>
          )}
          {groups.map(({ section, items: group }) => {
            const account = section === 'catAccount'
            if (!group.length && !account) return null
            return (
              <div key={section} className="pb-2">
                <div className="px-1 pb-2 pt-2.5 text-[11px] tracking-wide text-muted-token">{t(HEADING[section] ?? section)}</div>
                <div className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4">
                  {group.map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={item.tone === 'line' ? `${TILE} border-transparent! bg-line-green! font-semibold text-on-line-green! active:opacity-90` : TILE}
                      onClick={() => onOpenChange(false)}
                      data-testid={`more-${item.key}`}
                    >
                      <item.icon className={`size-6 ${item.tone === 'line' ? 'text-on-line-green' : 'text-muted-token'}`} aria-hidden />
                      <span>{t(item.label)}</span>
                    </Link>
                  ))}
                  {account && (
                    <button type="button" className={TILE} onClick={() => void logout()}>
                      <LogOut className="size-6 text-muted-token" aria-hidden />
                      <span>{t('logout')}</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
