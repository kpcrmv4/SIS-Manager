import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getActorState } from '@/lib/auth/actor'
import { BfcacheGuard } from '@/components/shell/bfcache-guard'
import { BottomNav } from '@/components/shell/bottom-nav'
import { Sidebar } from '@/components/shell/sidebar'
import { LiveProvider } from '@/components/realtime/live-provider'
import { ServiceWorkerRegister } from '@/components/pwa/sw-register'

/**
 * Staff shell. The auth decision lives HERE, not in a page under a loading
 * boundary (a redirect() below loading.tsx loses its 307).
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const state = await getActorState()
  if (state.status === 'anonymous') redirect('/api/auth/logout?reason=stale')
  if (state.status === 'inactive') redirect('/api/auth/logout?reason=inactive')
  const { actor } = state

  return (
    <LiveProvider userId={actor.id} branchId={actor.branch?.id ?? null}>
      <div className="flex min-h-dvh">
        <Sidebar role={actor.role} branches={actor.branches} branch={actor.branch} userId={actor.id} />
        <main className="min-w-0 max-w-[1120px] flex-1 px-4 pb-[104px] pt-4 nav:px-7 nav:pb-10 nav:pt-5.5">{children}</main>
        <BottomNav role={actor.role} branches={actor.branches} branch={actor.branch} userId={actor.id} />
        <BfcacheGuard />
        <ServiceWorkerRegister />
      </div>
    </LiveProvider>
  )
}
