import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseServer } from '@/lib/supabase/server'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { BranchForm, type BranchFormValue } from '@/components/settings/branch-form'
import { ExpiryNoticeForm } from '@/components/settings/expiry-notice-form'
import { LineNotifyCard } from '@/components/settings/line-notify-card'
import { LINE_NOTIFY_KINDS, lineQuota } from '@/lib/settings/line-notify'
import { PrintSettingsSection } from '@/components/settings/print-settings-section'
import { SetupCard } from '@/components/settings/setup-card'
import { getDashboard } from '@/lib/reports/dashboard'
import { SETUP_KEYS, setupItems, type SetupKey } from '@/lib/reports/dashboard-view'
import { expiryReminderDefaults } from '@/lib/line/catalog'
import type { ExpiryLocale } from '@/lib/line/expiry-template'
import { bangkokDate } from '@/lib/date'

// Built in P2-B3.
export default async function SettingsBranchPage() {
  const t = await getTranslations('settingsBranch')
  const tn = await getTranslations('nav')
  const state = await getActorState()
  if (state.status !== 'ok') return null
  const branch = state.actor.branch
  if (!branch) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState message={tn('switchBranch')} />
      </>
    )
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('branches')
    .select(
      'name, active, opens_at, closes_at, deposit_days, expiry_notice_days, withdrawal_blocked_days, receipt_settings, expiry_reminders_enabled, expired_notice_enabled, expiry_reminder_days, expiry_reminder_time, expiry_reminder_templates, line_notify_off',
    )
    .eq('id', branch.id)
    .maybeSingle()

  if (error || !data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <RefreshRetry />
      </>
    )
  }

  // setup progress of this branch (R-034) — the page still works if the dashboard read fails
  const to = await getTranslations('overview')
  const setup = await getDashboard()
    .then((d) => {
      const row = d.branches.find((b) => b.id === branch.id)
      return row ? setupItems([row], branch.id) : null
    })
    .catch(() => null)

  const receipt = (data.receipt_settings ?? {}) as { header?: string; footer?: string; copies?: number }
  const initial: BranchFormValue = {
    name: data.name,
    active: data.active,
    opensAt: data.opens_at,
    closesAt: data.closes_at,
    depositDays: data.deposit_days,
    expiryNoticeDays: data.expiry_notice_days,
    withdrawalBlockedDays: data.withdrawal_blocked_days,
    receiptHeader: receipt.header ?? '',
    receiptFooter: receipt.footer ?? '',
    receiptCopies: receipt.copies ?? 1,
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={branch.name} />
      {/* one gap between every card, as on every other page */}
      <div className="flex flex-col gap-4" data-testid="branch-settings">
        {setup && (
          <SetupCard
            items={setup}
            title={to('setupTitle')}
            progress={to('setupProgress', { done: setup.filter((s) => s.done).length, total: setup.length })}
            nextLabel={to('setupNext')}
            allLabel={to('setupAll', { count: setup.length })}
            doneLabel={to('setupDone')}
            go={to('setupGo')}
            labels={Object.fromEntries(SETUP_KEYS.map((k) => [k, to(`setup.${k}`)])) as Record<SetupKey, string>}
            hints={Object.fromEntries(SETUP_KEYS.map((k) => [k, to(`setupHint.${k}`)])) as Record<SetupKey, string>}
          />
        )}
        <BranchForm branchId={branch.id} initial={initial} />
        {/* R-063: which automatic LINE messages go out, and what they cost */}
        <LineNotifyCard branchId={branch.id} initialOff={data.line_notify_off} kinds={LINE_NOTIFY_KINDS} quota={await lineQuota(branch.id)} />
        <ExpiryNoticeForm
          branchId={branch.id}
          branchName={data.name}
          branchCode={branch.code}
          today={bangkokDate()}
          initial={{
            enabled: data.expiry_reminders_enabled,
            expiredEnabled: data.expired_notice_enabled,
            days: data.expiry_reminder_days,
            time: data.expiry_reminder_time,
            templates: (data.expiry_reminder_templates ?? {}) as Partial<Record<ExpiryLocale, string>>,
          }}
          defaults={expiryReminderDefaults()}
        />
        <PrintSettingsSection branchId={branch.id} branchCode={branch.code} />
      </div>
    </>
  )
}
