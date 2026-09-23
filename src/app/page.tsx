import { redirect } from 'next/navigation'
import { getActorState, landingFor } from '@/lib/auth/actor'

/** Role-aware landing: staff/bar → /tonight, owner → /overview. */
export default async function Home() {
  const state = await getActorState()
  // a JWT the proxy still trusts but Auth has revoked: clear it, or / ↔ /login loops
  if (state.status === 'anonymous') redirect('/api/auth/logout?reason=stale')
  if (state.status === 'inactive') redirect('/api/auth/logout?reason=inactive')
  redirect(landingFor(state.actor.role))
}
