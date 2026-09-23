import { redirect } from 'next/navigation'
import { getActorState, landingFor } from '@/lib/auth/actor'

/** Role-aware landing: staff/bar → /tonight, owner → /overview. */
export default async function Home() {
  const state = await getActorState()
  if (state.status === 'anonymous') redirect('/login')
  if (state.status === 'inactive') redirect('/api/auth/logout?reason=inactive')
  redirect(landingFor(state.actor.role))
}
