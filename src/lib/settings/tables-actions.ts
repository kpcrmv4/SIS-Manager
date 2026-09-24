'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { cleanText, isUuid } from '@/lib/action'
import type { Database } from '@/types/database'

type ZoneUpdate = Database['public']['Tables']['table_zones']['Update']
type TableUpdate = Database['public']['Tables']['tables']['Update']

/** Owner CRUD for table_zones / tables — session client, RLS restricts writes to owner. */
export type SettingsResult<T = undefined> = { ok: true; data: T } | { ok: false; error: 'invalid' | 'forbidden' | 'label_taken' }

function touched() {
  revalidatePath('/settings/tables')
  revalidatePath('/bookings')
}

export async function createZone(branchId: string, name: string, customerBookable: boolean, sort: number): Promise<SettingsResult<{ id: string }>> {
  const clean = cleanText(name, 60)
  if (!isUuid(branchId) || !clean) return { ok: false, error: 'invalid' }
  const { data, error } = await getSupabaseServer().then((sb) =>
    sb.from('table_zones').insert({ branch_id: branchId, name: clean, customer_bookable: customerBookable, sort: Math.trunc(sort) }).select('id').single(),
  )
  if (error) return { ok: false, error: 'invalid' }
  touched()
  return { ok: true, data: { id: data.id } }
}

export async function updateZone(id: string, patch: { name?: string; sort?: number; customerBookable?: boolean; active?: boolean }): Promise<SettingsResult> {
  if (!isUuid(id)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const row: ZoneUpdate = {}
  if (patch.name !== undefined) {
    const clean = cleanText(patch.name, 60)
    if (!clean) return { ok: false, error: 'invalid' }
    row.name = clean
  }
  if (patch.sort !== undefined) row.sort = Math.trunc(patch.sort)
  if (patch.customerBookable !== undefined) row.customer_bookable = patch.customerBookable
  if (patch.active !== undefined) row.active = patch.active
  const { data, error } = await sb.from('table_zones').update(row).eq('id', id).select('id').maybeSingle()
  if (error) return { ok: false, error: 'invalid' }
  if (!data) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: undefined }
}

export async function deleteZone(id: string): Promise<SettingsResult> {
  if (!isUuid(id)) return { ok: false, error: 'invalid' }
  const { data, error } = await (await getSupabaseServer()).from('table_zones').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: 'invalid' }
  // an RLS-refused delete matches zero rows and returns no error
  if (!data?.length) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: undefined }
}

export type CreateTableInput = {
  branchId: string
  zoneId: string
  label: string
  shape: 'square' | 'round' | 'room'
  seatsMin: number
  seatsMax: number
  sort: number
  customerBookable: boolean
}

export async function createTable(input: CreateTableInput): Promise<SettingsResult<{ id: string }>> {
  const label = cleanText(input.label, 12)
  if (!isUuid(input.branchId) || !isUuid(input.zoneId) || !label) return { ok: false, error: 'invalid' }
  const { data, error } = await (await getSupabaseServer())
    .from('tables')
    .insert({
      branch_id: input.branchId,
      zone_id: input.zoneId,
      label,
      shape: input.shape,
      seats_min: Math.trunc(input.seatsMin),
      seats_max: Math.trunc(input.seatsMax),
      sort: Math.trunc(input.sort),
      customer_bookable: input.customerBookable,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.code === '23505' ? 'label_taken' : 'invalid' }
  touched()
  return { ok: true, data: { id: data.id } }
}

export type UpdateTableInput = {
  label?: string
  zoneId?: string
  shape?: 'square' | 'round' | 'room'
  seatsMin?: number
  seatsMax?: number
  sort?: number
  active?: boolean
  customerBookable?: boolean
}

export async function updateTable(id: string, patch: UpdateTableInput): Promise<SettingsResult> {
  if (!isUuid(id)) return { ok: false, error: 'invalid' }
  const row: TableUpdate = {}
  if (patch.label !== undefined) {
    const clean = cleanText(patch.label, 12)
    if (!clean) return { ok: false, error: 'invalid' }
    row.label = clean
  }
  if (patch.zoneId !== undefined) {
    if (!isUuid(patch.zoneId)) return { ok: false, error: 'invalid' }
    row.zone_id = patch.zoneId
  }
  if (patch.shape !== undefined) row.shape = patch.shape
  if (patch.seatsMin !== undefined) row.seats_min = Math.trunc(patch.seatsMin)
  if (patch.seatsMax !== undefined) row.seats_max = Math.trunc(patch.seatsMax)
  if (patch.sort !== undefined) row.sort = Math.trunc(patch.sort)
  if (patch.active !== undefined) row.active = patch.active
  if (patch.customerBookable !== undefined) row.customer_bookable = patch.customerBookable
  const { data, error } = await (await getSupabaseServer()).from('tables').update(row).eq('id', id).select('id').maybeSingle()
  if (error) return { ok: false, error: error.code === '23505' ? 'label_taken' : 'invalid' }
  if (!data) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: undefined }
}

export async function deleteTable(id: string): Promise<SettingsResult> {
  if (!isUuid(id)) return { ok: false, error: 'invalid' }
  const { data, error } = await (await getSupabaseServer()).from('tables').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: 'invalid' }
  if (!data?.length) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: undefined }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Close one table to customers on one night (R-036) — owner only, through RLS. */
export async function addTableBlock(branchId: string, tableId: string, night: string): Promise<SettingsResult<{ id: string }>> {
  if (!isUuid(branchId) || !isUuid(tableId) || !YMD.test(night)) return { ok: false, error: 'invalid' }
  const { data, error } = await (await getSupabaseServer()).from('table_blocks').insert({ branch_id: branchId, table_id: tableId, night }).select('id').single()
  if (error) return { ok: false, error: error.code === '42501' ? 'forbidden' : 'invalid' }
  touched()
  return { ok: true, data: { id: data.id } }
}

/** Open that night again. */
export async function removeTableBlock(id: string): Promise<SettingsResult> {
  if (!isUuid(id)) return { ok: false, error: 'invalid' }
  const { data, error } = await (await getSupabaseServer()).from('table_blocks').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: 'invalid' }
  // an RLS-refused delete matches zero rows and returns no error
  if (!data?.length) return { ok: false, error: 'forbidden' }
  touched()
  return { ok: true, data: undefined }
}
