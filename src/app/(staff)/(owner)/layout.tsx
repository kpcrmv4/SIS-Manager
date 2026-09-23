import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getActorState } from '@/lib/auth/actor'

/** Owner-only pages (overview, reports, settings). The role gate lives in the layout, above any loading boundary. */
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const state = await getActorState()
  if (state.status !== 'ok' || state.actor.role !== 'owner') notFound()
  return children
}
