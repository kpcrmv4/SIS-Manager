'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Store, UsersRound } from 'lucide-react'
import { UsersTab, type UserRow } from './users-tab'
import { BranchesTab, type BranchListRow } from './branches-tab'

export function SettingsUsersClient({ meId, users, branches, loginUrl }: { meId: string; users: UserRow[]; branches: BranchListRow[]; loginUrl?: string }) {
  const t = useTranslations('settingsUsers')
  const [tab, setTab] = useState<'users' | 'branches'>('users')

  return (
    <>
      {/* the same filter cards as ฝากเหล้า — an icon, the count, the name (owner, 2026-09-28) */}
      <nav aria-label={t('title')} className="mb-4 grid grid-cols-2 gap-2 sm:max-w-md" data-testid="users-tabs">
        {(
          [
            ['users', UsersRound, 'info', users.length, t('tabUsers')],
            ['branches', Store, 'violet', branches.length, t('tabBranches')],
          ] as const
        ).map(([key, Icon, tone, count, label]) => (
          <button
            key={key}
            type="button"
            className="fcard text-left"
            aria-current={tab === key ? 'page' : undefined}
            data-tone={tone}
            data-count={count}
            onClick={() => setTab(key)}
            data-testid={`users-tab-${key}`}
          >
            <span className="top">
              <span className="ic" aria-hidden>
                <Icon className="size-4.5" />
              </span>
              <span className="c">{count}</span>
            </span>
            <span className="l">{label}</span>
          </button>
        ))}
      </nav>
      {tab === 'users' ? (
        <UsersTab meId={meId} users={users} branches={branches.map((b) => ({ id: b.id, name: b.name }))} loginUrl={loginUrl} />
      ) : (
        <BranchesTab branches={branches} />
      )}
    </>
  )
}
