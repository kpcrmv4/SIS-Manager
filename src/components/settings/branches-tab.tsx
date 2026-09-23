'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { ResponsiveDialog } from '@/components/booking/responsive-dialog'
import { BranchForm, type BranchFormValue } from './branch-form'
import { createBranch } from '@/lib/settings/branch-actions'

export type BranchListRow = { id: string; code: string; name: string; active: boolean; detail: BranchFormValue }

function CreateBranchDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const t = useTranslations('settingsUsers')
  const tc = useTranslations('common')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await createBranch(code, name)
      if (!res.ok) {
        toast.error(res.error === 'code_taken' ? t('codeTaken') : tc('errorGeneric'))
        return
      }
      toast.success(tc('saved'))
      setCode('')
      setName('')
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('addBranch')}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="label-base" htmlFor="cb-code">
            {t('branchCode')}
          </label>
          <input id="cb-code" className="input-base code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} />
          <p className="help-text">{t('branchCodeHelp', { code: code || 'XX' })}</p>
        </div>
        <div>
          <label className="label-base" htmlFor="cb-name">
            {t('branchName')}
          </label>
          <input id="cb-name" className="input-base" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </button>
        <button type="button" className="btn-primary" disabled={pending || !/^[A-Z]{2,5}$/.test(code) || !name.trim()} onClick={submit} data-testid="create-branch-submit">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('save')}
        </button>
      </div>
    </ResponsiveDialog>
  )
}

export function BranchesTab({ branches }: { branches: BranchListRow[] }) {
  const t = useTranslations('settingsUsers')
  const ts = useTranslations('settingsBranch')
  const tc = useTranslations('common')
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<BranchListRow | null>(null)
  const refresh = () => router.refresh()

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setAdding(true)} data-testid="add-branch-button">
          <Plus className="size-4" aria-hidden />
          {t('addBranch')}
        </button>
      </div>

      <div className="panel overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('branchCode')}</th>
              <th>{t('branchName')}</th>
              <th>{ts('depositDays')}</th>
              <th>{ts('active')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id} data-testid="branch-row">
                <td className="code">{b.code}</td>
                <td>{b.name}</td>
                <td className="tnum">{b.detail.depositDays}</td>
                <td>
                  <Badge tone={b.active ? 'done' : 'pending'}>{b.active ? tc('yes') : tc('no')}</Badge>
                </td>
                <td>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(b)}>
                    {tc('edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateBranchDialog open={adding} onOpenChange={setAdding} onSaved={refresh} />

      {editing && (
        <ResponsiveDialog open onOpenChange={(v) => !v && setEditing(null)} title={editing.name} width={520}>
          <BranchForm branchId={editing.id} initial={editing.detail} onSaved={() => { setEditing(null); refresh() }} />
        </ResponsiveDialog>
      )}
    </>
  )
}
