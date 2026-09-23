'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Store } from 'lucide-react'
import { setBranch } from '@/lib/auth/actions'
import type { BranchRef } from '@/lib/auth/actor'

export function BranchSwitcher({
  branches,
  branch,
  variant,
}: {
  branches: BranchRef[]
  branch: BranchRef | null
  variant: 'sidebar' | 'sheet'
}) {
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const router = useRouter()
  const [pending, start] = useTransition()

  function onChange(id: string) {
    start(async () => {
      const res = await setBranch(id)
      if (!res.ok) {
        toast.error(tc('errorGeneric'))
        return
      }
      router.refresh()
    })
  }

  const dark = variant === 'sidebar'
  return (
    <label className={`flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-sm ${dark ? 'bg-sidebar-hover' : 'border border-line bg-card'}`}>
      <Store className={`size-4 flex-none ${dark ? 'text-sidebar-fg-dim' : 'text-muted-token'}`} aria-hidden />
      <span className="sr-only">{t('switchBranch')}</span>
      <select
        value={branch?.id ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        data-testid="branch-switcher"
        className={`min-w-0 flex-1 appearance-none bg-transparent outline-none ${dark ? 'text-sidebar-title' : 'text-ink'}`}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id} className="bg-card text-ink">
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}
