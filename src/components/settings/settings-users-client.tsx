'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { UsersTab, type UserRow } from './users-tab'
import { BranchesTab, type BranchListRow } from './branches-tab'

export function SettingsUsersClient({ meId, users, branches, loginUrl }: { meId: string; users: UserRow[]; branches: BranchListRow[]; loginUrl?: string }) {
  const t = useTranslations('settingsUsers')
  const [tab, setTab] = useState<'users' | 'branches'>('users')

  return (
    <>
      <div className="tabs mb-4" role="tablist">
        <button type="button" className="tab" aria-selected={tab === 'users'} role="tab" onClick={() => setTab('users')}>
          {t('tabUsers')}
        </button>
        <button type="button" className="tab" aria-selected={tab === 'branches'} role="tab" onClick={() => setTab('branches')}>
          {t('tabBranches')}
        </button>
      </div>
      {tab === 'users' ? (
        <UsersTab meId={meId} users={users} branches={branches.map((b) => ({ id: b.id, name: b.name }))} loginUrl={loginUrl} />
      ) : (
        <BranchesTab branches={branches} />
      )}
    </>
  )
}
