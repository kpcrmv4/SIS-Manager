'use client'

import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'
import type { BranchRef } from '@/lib/auth/actor'
import { BranchSwitcher } from './branch-switcher'
import { logout } from './logout'
import type { NavItem, NavSection } from './nav'
import { ThemeToggle } from './theme-toggle'

const ROW = 'flex w-full items-center gap-3 border-b border-line px-1 py-3.25 text-[15px] text-ink last:border-b-0'

const HEADING: Partial<Record<NavSection, string>> = {
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
  const groups = (['catReports', 'catSettings', 'catAccount'] as const).map((s) => ({
    section: s,
    items: items.filter((i) => i.section === s),
  }))

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/45" />
        <Dialog.Content
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
              <div key={section}>
                <div className="px-1 pb-1 pt-2.5 text-[11px] tracking-wide text-muted-token">{t(HEADING[section] ?? section)}</div>
                {group.map((item) => (
                  <Link key={item.key} href={item.href} className={ROW} onClick={() => onOpenChange(false)}>
                    <item.icon className="size-5 text-muted-token" aria-hidden />
                    {t(item.label)}
                  </Link>
                ))}
                {account && (
                  <>
                    <ThemeToggle className={ROW} />
                    <button type="button" className={ROW} onClick={() => void logout()}>
                      <LogOut className="size-5 text-muted-token" aria-hidden />
                      {t('logout')}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
