import { getLocale } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { ManualView } from '@/components/manual/manual-view'
import { getActorState } from '@/lib/auth/actor'
import { manualFor } from '@/lib/manual'

/** คู่มือการใช้งาน — every role reads the pages of its own role (the owner reads them all). */
export default async function ManualPage() {
  const state = await getActorState()
  if (state.status !== 'ok') return null
  const manual = manualFor(await getLocale())
  return (
    <>
      <PageHeader title={manual.title} subtitle={manual.subtitle} />
      <ManualView manual={manual} role={state.actor.role} />
    </>
  )
}
