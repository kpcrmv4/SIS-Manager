'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { MoreHorizontal } from 'lucide-react'
import type { BranchRef, Role } from '@/lib/auth/actor'
import { isActive, navFor } from './nav'
import { MoreSheet } from './more-sheet'

/**
 * Phones: 5 slots — home · ฝากเหล้า · [scan, raised, icon only] · จองโต๊ะ · เพิ่มเติม.
 * Everything else lives in the เพิ่มเติม bottom sheet.
 */
export function BottomNav({ role, branches, branch }: { role: Role; branches: BranchRef[]; branch: BranchRef | null }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const items = navFor(role)
  const primary = items.find((i) => i.primary)
  const bySlot = (n: 1 | 2 | 4) => items.find((i) => i.slot === n)
  const overflow = items.filter((i) => !i.primary && !i.slot)
  const overflowActive = overflow.some((i) => isActive(i, pathname))

  const slot = (n: 1 | 2 | 4) => {
    const item = bySlot(n)
    if (!item) return <span />
    const Icon = item.icon
    const active = isActive(item, pathname)
    const label = n === 1 && role === 'owner' ? t('overviewShort') : t(item.label)
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`flex flex-col items-center justify-center gap-0.5 text-[10.5px] ${active ? 'font-semibold text-brand' : 'text-muted-token'}`}
      >
        <Icon className="size-5" aria-hidden />
        <span>{label}</span>
      </Link>
    )
  }

  return (
    <>
      <nav
        aria-label={t('mainMenu')}
        className="fixed inset-x-0 bottom-0 z-20 grid h-[calc(64px+env(safe-area-inset-bottom,0px))] grid-cols-5 border-t border-line bg-card pb-[env(safe-area-inset-bottom,0px)] nav:hidden"
      >
        {slot(1)}
        {slot(2)}
        {primary ? (
          <div className="relative">
            <Link
              href={primary.href}
              aria-label={t(primary.label)}
              aria-current={isActive(primary, pathname) ? 'page' : undefined}
              className="absolute left-1/2 top-[-20px] flex size-[58px] -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-canvas bg-sidebar text-accent shadow-[0_8px_20px_rgba(0,0,0,.28)]"
            >
              <primary.icon className="size-[26px]" aria-hidden />
            </Link>
          </div>
        ) : (
          <span />
        )}
        {slot(4)}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={`flex flex-col items-center justify-center gap-0.5 text-[10.5px] ${overflowActive ? 'font-semibold text-brand' : 'text-muted-token'}`}
        >
          <MoreHorizontal className="size-5" aria-hidden />
          <span>{t('more')}</span>
        </button>
      </nav>
      <MoreSheet open={open} onOpenChange={setOpen} items={overflow} branches={branches} branch={branch} />
    </>
  )
}
