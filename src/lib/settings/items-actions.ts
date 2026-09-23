'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { cleanText, isUuid } from '@/lib/action'
import type { Database } from '@/types/database'

type ItemUpdate = Database['public']['Tables']['liquor_items']['Update']

/** Owner CRUD for liquor_items — session client, RLS restricts writes to owner. */
export type SettingsResult<T = undefined> = { ok: true; data: T } | { ok: false; error: 'invalid' | 'forbidden' }

function touched() {
  revalidatePath('/settings/items')
  revalidatePath('/deposits/new')
}

export type ItemInput = {
  name: string
  category: string
  branchId: string | null
  active: boolean
  sort: number
}

export async function createItem(input: ItemInput): Promise<SettingsResult<{ id: string }>> {
  const name = cleanText(input.name, 120)
  if (!name || (input.branchId !== null && !isUuid(input.branchId))) return { ok: false, error: 'invalid' }
  const { data, error } = await (await getSupabaseServer())
    .from('liquor_items')
    .insert({ name, category: input.category, branch_id: input.branchId, active: input.active, sort: Math.trunc(input.sort) })
    .select('id')
    .single()
  if (error) return { ok: false, error: 'invalid' }
  touched()
  return { ok: true, data: { id: data.id } }
}

export async function updateItem(id: string, patch: Partial<ItemInput>): Promise<SettingsResult> {
  if (!isUuid(id)) return { ok: false, error: 'invalid' }
  const row: ItemUpdate = {}
  if (patch.name !== undefined) {
    const clean = cleanText(patch.name, 120)
    if (!clean) return { ok: false, error: 'invalid' }
    row.name = clean
  }
  if (patch.category !== undefined) row.category = patch.category
  if (patch.branchId !== undefined) {
    if (patch.branchId !== null && !isUuid(patch.branchId)) return { ok: false, error: 'invalid' }
    row.branch_id = patch.branchId
  }
  if (patch.active !== undefined) row.active = patch.active
  if (patch.sort !== undefined) row.sort = Math.trunc(patch.sort)
  const { data, error } = await (await getSupabaseServer()).from('liquor_items').update(row).eq('id', id).select('id').maybeSingle()
  if (error) return { ok: false, error: 'invalid' }
  if (!data) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: undefined }
}
