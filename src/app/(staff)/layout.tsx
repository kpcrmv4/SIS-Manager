import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getActorState } from '@/lib/auth/actor'
import { BfcacheGuard } from '@/components/shell/bfcache-guard'
import { BottomNav } from '@/components/shell/bottom-nav'
import { Sidebar } from '@/components/shell/sidebar'
import { TopBar } from '@/components/shell/top-bar'
import { LiveProvider } from '@/components/realtime/live-provider'
import { ServiceWorkerRegister } from '@/components/pwa/sw-register'
import { NavTrail } from '@/components/shell/nav-trail'

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
        <Sidebar role={actor.role} branches={actor.branches} branch={actor.branch} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar userId={actor.id} branches={actor.branches} branch={actor.branch} owner={actor.role === 'owner'} />
          <main className="min-w-0 flex-1 px-4 pb-[104px] pt-1 nav:px-7 nav:pb-10 nav:pt-0">{children}</main>
        </div>
        <BottomNav role={actor.role} branches={actor.branches} branch={actor.branch} />
        <BfcacheGuard />
        <NavTrail />
        <ServiceWorkerRegister />
      </div>
    </LiveProvider>
  )
}
