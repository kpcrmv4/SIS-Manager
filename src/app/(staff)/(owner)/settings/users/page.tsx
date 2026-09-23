import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseServer } from '@/lib/supabase/server'
import { SettingsUsersClient } from '@/components/settings/settings-users-client'
import type { UserRow } from '@/components/settings/users-tab'
import type { BranchListRow } from '@/components/settings/branches-tab'

// Built in P2-B3.
export default async function SettingsUsersPage() {
  const t = await getTranslations('settingsUsers')
  const state = await getActorState()
  if (state.status !== 'ok') return null

  const sb = await getSupabaseServer()
  const [{ data: allProfiles, error: pError }, { data: userBranches, error: ubError }, { data: branches, error: bError }, { data: stations, error: sError }] = await Promise.all([
    sb.from('profiles').select('id, username, display_name, role, active').order('username').range(0, 499),
    sb.from('user_branches').select('user_id, branch_id').range(0, 999),
    sb
      .from('branches')
      .select('id, code, name, active, deposit_days, expiry_notice_days, withdrawal_blocked_days, opens_at, closes_at, receipt_settings')
      .order('sort')
      .range(0, 199),
    sb.from('print_stations').select('account_id').range(0, 199),
  ])

  if (pError || ubError || bError || sError) {
    return (
      <>
        <PageHeader title={t('title')} />
        <RefreshRetry />
      </>
    )
  }

  const branchesByUser = new Map<string, string[]>()
  for (const r of userBranches ?? []) {
    const list = branchesByUser.get(r.user_id) ?? []
    list.push(r.branch_id)
    branchesByUser.set(r.user_id, list)
  }

  // print-server accounts are managed from ข้อมูลสาขา → เครื่องพิมพ์, never as staff users
  const printIds = new Set((stations ?? []).map((s) => s.account_id).filter(Boolean))
  const profiles = (allProfiles ?? []).filter((p) => !printIds.has(p.id) && !/^printer-[a-z]{2,5}$/.test(p.username))
  const users: UserRow[] = profiles.map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    role: p.role,
    active: p.active,
    branchIds: branchesByUser.get(p.id) ?? [],
  }))

  const branchRows: BranchListRow[] = (branches ?? []).map((b) => {
    const receipt = (b.receipt_settings ?? {}) as { header?: string; footer?: string; copies?: number }
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      active: b.active,
      detail: {
        name: b.name,
        active: b.active,
        opensAt: b.opens_at,
        closesAt: b.closes_at,
        depositDays: b.deposit_days,
        expiryNoticeDays: b.expiry_notice_days,
        withdrawalBlockedDays: b.withdrawal_blocked_days,
        receiptHeader: receipt.header ?? '',
        receiptFooter: receipt.footer ?? '',
        receiptCopies: receipt.copies ?? 1,
      },
    }
  })

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <SettingsUsersClient meId={state.actor.id} users={users} branches={branchRows} />
    </>
  )
}
