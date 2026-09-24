import type { Db } from './db'

/**
 * Zones/tables/settings shared by the P2-B1/P2-B2 specs — branch A of this
 * run's fixture set (ZBA when E2E_FIXTURE=B) only. Every helper here is
 * idempotent within a test run: callers clear what they made in afterAll.
 */

export const DEFAULT_SETTINGS = {
  line_enabled: true,
  auto_confirm: false,
  advance_days: 14,
  cutoff_time: '18:00',
  slot_start: '19:00',
  slot_end: '23:00',
  slot_minutes: 30,
  max_bookings_per_night: null as number | null,
  party_min: 1,
  party_max: 12,
  no_show_minutes: 30,
  customer_cancel_hours: 2,
  closed_weekdays: [] as number[],
  table_choice: 'shop' as 'shop' | 'customer',
}

export async function resetSettings(admin: Db, branchId: string, patch: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const { error } = await admin.from('booking_settings').update({ ...DEFAULT_SETTINGS, ...patch }).eq('branch_id', branchId)
  if (error) throw new Error(`booking_settings: ${error.message}`)
}

export async function clearBookings(admin: Db, branchIds: string[]) {
  await admin.from('bookings').delete().in('branch_id', branchIds)
  await admin.from('booking_blackouts').delete().in('branch_id', branchIds)
}

export type ZoneTableSet = {
  zoneStage: string
  zoneVip: string
  tableA1: string
  tableA2: string
  tableV1: string
}

/** Two zones (a customer-bookable "stage" zone, a staff-only "VIP" zone) with a few tables each. */
export async function setupZonesAndTables(admin: Db, branchId: string): Promise<ZoneTableSet> {
  await admin.from('tables').delete().eq('branch_id', branchId)
  await admin.from('table_zones').delete().eq('branch_id', branchId)
  const stage = await admin.from('table_zones').insert({ branch_id: branchId, name: 'หน้าเวที P2B', sort: 1 }).select('id').single()
  const vip = await admin.from('table_zones').insert({ branch_id: branchId, name: 'VIP P2B', sort: 2, customer_bookable: false }).select('id').single()
  if (stage.error || vip.error) throw new Error(`zones: ${stage.error?.message ?? vip.error?.message}`)
  const a1 = await admin.from('tables').insert({ branch_id: branchId, zone_id: stage.data.id, label: 'PA1', shape: 'square', seats_min: 2, seats_max: 4, sort: 1 }).select('id').single()
  const a2 = await admin.from('tables').insert({ branch_id: branchId, zone_id: stage.data.id, label: 'PA2', shape: 'round', seats_min: 2, seats_max: 2, sort: 2 }).select('id').single()
  const v1 = await admin.from('tables').insert({ branch_id: branchId, zone_id: vip.data.id, label: 'PV1', shape: 'room', seats_min: 4, seats_max: 10, sort: 1 }).select('id').single()
  if (a1.error || a2.error || v1.error) throw new Error(`tables: ${a1.error?.message ?? a2.error?.message ?? v1.error?.message}`)
  return { zoneStage: stage.data.id, zoneVip: vip.data.id, tableA1: a1.data.id, tableA2: a2.data.id, tableV1: v1.data.id }
}

export async function teardownZonesAndTables(admin: Db, branchId: string) {
  await admin.from('tables').delete().eq('branch_id', branchId)
  await admin.from('table_zones').delete().eq('branch_id', branchId)
}
