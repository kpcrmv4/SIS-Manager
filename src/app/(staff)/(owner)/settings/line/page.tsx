import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { LineSettings } from '@/components/settings/line-settings'
import { getActorState } from '@/lib/auth/actor'
import { liffUrl } from '@/lib/line/render'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getSupabaseServer } from '@/lib/supabase/server'

/** P3-A2-06..09 — the owner gate is the (owner) layout (staff / bar get 404 before this renders). */
export default async function SettingsLinePage() {
  const t = await getTranslations('settingsLine')
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
  const [{ data, error }, { data: secrets, error: secretError }] = await Promise.all([
    sb.from('branches').select('liff_id, line_channel_id, line_bot_user_id, staff_group_id').eq('id', branch.id).maybeSingle(),
    // read on the server only to say "set / not set" — the values never reach the page
    getSupabaseAdmin().from('branch_line_secrets').select('channel_access_token, channel_secret').eq('branch_id', branch.id).maybeSingle(),
  ])
  if (error || secretError || !data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <RefreshRetry />
      </>
    )
  }

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  const base = (process.env.APP_BASE_URL || (host ? `${proto}://${host}` : '')).replace(/\/+$/, '')

  return (
    <>
      <PageHeader title={t('title')} />
      <LineSettings
        key={branch.id}
        branchId={branch.id}
        initial={{ liffId: data.liff_id ?? '', channelId: data.line_channel_id ?? '', botUserId: data.line_bot_user_id ?? '' }}
        hasToken={!!secrets?.channel_access_token}
        hasSecret={!!secrets?.channel_secret}
        groupBound={!!data.staff_group_id}
        webhookUrl={`${base}/api/line/webhook/${branch.code.toLowerCase()}`}
        liffEndpoint={`${base}/liff/${branch.code.toLowerCase()}`}
        liffLink={liffUrl(data.liff_id)}
      />
    </>
  )
}
