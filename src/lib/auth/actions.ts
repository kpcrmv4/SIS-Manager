'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { STAFF_LOCALE_COOKIE, isStaffLocale } from '@/lib/i18n/config'
import { getSupabaseServer } from '@/lib/supabase/server'
import { BRANCH_COOKIE, getActorState } from './actor'

const YEAR = 60 * 60 * 24 * 365

export type ActionResult = { ok: true } | { ok: false; error: string }

/** Switch the working branch. Only a branch the actor can see (RLS) is accepted. */
export async function setBranch(branchId: string): Promise<ActionResult> {
  const state = await getActorState()
  if (state.status !== 'ok') return { ok: false, error: 'unauthenticated' }
  if (!state.actor.branches.some((b) => b.id === branchId)) return { ok: false, error: 'forbidden' }
  const store = await cookies()
  store.set(BRANCH_COOKIE, branchId, { path: '/', maxAge: YEAR, sameSite: 'lax', httpOnly: true })
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Staff UI language — stored on the profile and mirrored in a cookie for next-intl. */
export async function setLocale(locale: string): Promise<ActionResult> {
  if (!isStaffLocale(locale)) return { ok: false, error: 'invalid' }
  const state = await getActorState()
  if (state.status !== 'ok') return { ok: false, error: 'unauthenticated' }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('profiles')
    .update({ locale })
    .eq('id', state.actor.id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: 'unavailable' }
  if (!data) return { ok: false, error: 'forbidden' }
  const store = await cookies()
  store.set(STAFF_LOCALE_COOKIE, locale, { path: '/', maxAge: YEAR, sameSite: 'lax' })
  revalidatePath('/', 'layout')
  return { ok: true }
}
