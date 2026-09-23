'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { ListRow } from '@/components/ui/list-row'
import { UserDialog, type UserDialogValue } from './user-dialog'
import { ResetPasswordDialog } from './reset-password-dialog'

export type UserRow = { id: string; username: string; displayName: string; role: 'staff' | 'bar' | 'owner'; active: boolean; branchIds: string[] }

export function UsersTab({ meId, users, branches }: { meId: string; users: UserRow[]; branches: { id: string; name: string }[] }) {
  const t = useTranslations('settingsUsers')
  const tr = useTranslations('roles')
  const tc = useTranslations('common')
  const router = useRouter()
  const [dialog, setDialog] = useState<{ value: UserDialogValue; isSelf: boolean } | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const refresh = () => router.refresh()

  const openEdit = (u: UserRow) =>
    setDialog({ value: { id: u.id, username: u.username, displayName: u.displayName, role: u.role, branchIds: u.branchIds, active: u.active }, isSelf: u.id === meId })

  const branchNames =(ids: string[]) =>
    ids.length ? ids.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean).join(', ') : '—'

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={() => setDialog({ value: { username: '', displayName: '', role: 'staff', branchIds: [], active: true }, isSelf: false })}
          data-testid="add-user-button"
        >
          <Plus className="size-4" aria-hidden />
          {t('addUser')}
        </button>
      </div>

      {users.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <>
          <div className="panel hidden overflow-x-auto nav:block" data-testid="users-table-desktop">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('username')}</th>
                  <th>{t('displayName')}</th>
                  <th>{t('role')}</th>
                  <th>{t('branches')}</th>
                  <th>{t('active')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} data-testid="user-row">
                    <td className="code">{u.username}</td>
                    <td>{u.displayName}</td>
                    <td>{tr(u.role)}</td>
                    <td className="text-sm">{branchNames(u.branchIds)}</td>
                    <td>
                      <Badge tone={u.active ? 'done' : 'pending'}>{u.active ? t('active') : t('inactive')}</Badge>
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-2">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(u)}>
                          {tc('edit')}
                        </button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setResetId(u.id)}>
                          {t('resetPassword')}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel nav:hidden" data-testid="users-list-mobile">
            {users.map((u) => (
              <ListRow
                key={u.id}
                title={u.displayName}
                meta={
                  <>
                    <span className="code">{u.username}</span> · {tr(u.role)} · {branchNames(u.branchIds)}
                  </>
                }
                aside={
                  <>
                    <Badge tone={u.active ? 'done' : 'pending'}>{u.active ? t('active') : t('inactive')}</Badge>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(u)}>
                      {tc('edit')}
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setResetId(u.id)}>
                      {t('resetPassword')}
                    </button>
                  </>
                }
              />
            ))}
          </div>
        </>
      )}

      {dialog && (
        <UserDialog
          open
          branches={branches}
          initial={dialog.value}
          isSelf={dialog.isSelf}
          onOpenChange={(v) => !v && setDialog(null)}
          onSaved={refresh}
        />
      )}
      {resetId && <ResetPasswordDialog open userId={resetId} onOpenChange={(v) => !v && setResetId(null)} onDone={refresh} />}
    </>
  )
}
