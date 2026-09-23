'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { BranchRef, Role } from '@/lib/auth/actor'
import { Brandmark } from './brandmark'
import { BranchSwitcher } from './branch-switcher'
import { LogOut } from 'lucide-react'
import { logout } from './logout'
import { isActive, navFor, type NavSection } from './nav'
import { ThemeToggle } from './theme-toggle'

const SECTIONS: NavSection[] = ['catDaily', 'catReports', 'catSettings', 'catAccount']

export function Sidebar({ role, branches, branch }: { role: Role; branches: BranchRef[]; branch: BranchRef | null }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const items = navFor(role)

  return (
    <nav
      aria-label={t('mainMenu')}
      className="sticky top-0 hidden h-dvh w-60 flex-none flex-col gap-0.5 overflow-y-auto bg-sidebar px-3 py-4.5 text-sidebar-fg nav:flex"
    >
      <Brandmark subtitle={branch?.name ?? null} />
      {branches.length > 1 && (
        <div className="mb-1 px-1">
          <BranchSwitcher branches={branches} branch={branch} variant="sidebar" />
        </div>
      )}
      {SECTIONS.map((section) => {
        const group = items.filter((i) => i.section === section)
        if (!group.length) return null
        return (
          <div key={section} className="flex flex-col gap-0.5">
            <div className="px-3 pb-1.5 pt-3.5 text-[11px] font-medium tracking-wide text-sidebar-fg-dim">{t(section)}</div>
            {group.map((item) => {
              const active = isActive(item, pathname)
              const Icon = item.icon
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.25 text-sm transition-colors ${
                    active ? 'bg-sidebar-active-bg font-semibold text-sidebar-active-fg' : 'hover:bg-sidebar-hover'
                  }`}
                >
                  <Icon className="size-5 flex-none" aria-hidden />
                  <span className="truncate">{t(item.label)}</span>
                </Link>
              )
            })}
          </div>
        )
      })}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-sidebar-line pt-2">
        <ThemeToggle className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.25 text-sm hover:bg-sidebar-hover" />
        <button
          type="button"
          onClick={() => void logout()}
          className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.25 text-sm hover:bg-sidebar-hover"
        >
          <LogOut className="size-5 flex-none" aria-hidden />
          {t('logout')}
        </button>
      </div>
    </nav>
  )
}
