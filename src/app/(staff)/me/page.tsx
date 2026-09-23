import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { getActorState } from '@/lib/auth/actor'
import { AccountSettings } from './account-settings'
import { PasswordForm } from './password-form'
import { PushToggle } from '@/components/pwa/push-toggle'

export default async function MePage() {
  const t = await getTranslations('me')
  const tr = await getTranslations('roles')
  const tu = await getTranslations('settingsUsers')
  const state = await getActorState()
  if (state.status !== 'ok') return null
  const { actor } = state

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="grid max-w-[640px] gap-4">
        <section className="card-surface p-4">
          <h2 className="mb-3 text-[15px] font-semibold">{t('profile')}</h2>
          <dl className="kv">
            <dt>{tu('displayName')}</dt>
            <dd className="truncate">{actor.displayName}</dd>
            <dt>{tu('username')}</dt>
            <dd className="truncate">@{actor.username}</dd>
            <dt>{tu('role')}</dt>
            <dd>{tr(actor.role)}</dd>
            <dt>{tu('branches')}</dt>
            <dd>{actor.branches.map((b) => b.name).join(', ') || '—'}</dd>
          </dl>
        </section>
        <AccountSettings locale={actor.locale} />
        <PushToggle />
        <PasswordForm />
      </div>
    </>
  )
}
