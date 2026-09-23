import { expect } from '@playwright/test'
import type { Db } from './db'
import type { Json } from '../../../src/types/database'

/** Deletes the branch's print account (if any) and its print_stations row — used in afterAll so a run never leaves a live auth user behind. */
export async function cleanupPrintStation(db: Db, branchId: string) {
  const { data: station } = await db.from('print_stations').select('account_id').eq('branch_id', branchId).maybeSingle()
  if (station?.account_id) {
    await db.auth.admin.deleteUser(station.account_id).catch(() => undefined)
  }
  await db.from('print_stations').delete().eq('branch_id', branchId)
}

/** A print_stations row with a fresh heartbeat — the branch reads 'online'. */
export async function markStationOnline(db: Db, branchId: string) {
  const { error } = await db.from('print_stations').upsert({ branch_id: branchId, is_online: true, last_heartbeat: new Date().toISOString() }, { onConflict: 'branch_id' })
  expect(error, error?.message).toBeNull()
}

/** A stale (>2 min) heartbeat — the branch reads 'offline' even though a station row exists. */
export async function markStationOffline(db: Db, branchId: string) {
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { error } = await db.from('print_stations').upsert({ branch_id: branchId, is_online: false, last_heartbeat: stale }, { onConflict: 'branch_id' })
  expect(error, error?.message).toBeNull()
}

/** Flips a print_jobs row to 'failed' directly (bypassing the print-server, which this suite never runs) so the retry button can be exercised deterministically. */
export async function failPrintJob(db: Db, jobId: string, message = 'E2E simulated failure') {
  const { error } = await db.from('print_jobs').update({ status: 'failed', error_message: message }).eq('id', jobId)
  expect(error, error?.message).toBeNull()
}

/** Sets `branches.line_bot_user_id` directly — worker A's /settings/line page (P3-A) is still a placeholder, so this simulates its precondition for the receipt-QR tests without touching that page. */
export async function setLineBotUserId(db: Db, branchId: string, value: string | null) {
  const { error } = await db.from('branches').update({ line_bot_user_id: value }).eq('id', branchId)
  expect(error, error?.message).toBeNull()
}

/** Restores every field this suite's print-settings tests can touch, so a later run (or another spec reading the same fixture branch) sees a clean slate. */
export async function resetPrintFields(db: Db, branchId: string) {
  const { data: current } = await db.from('branches').select('receipt_settings').eq('id', branchId).maybeSingle()
  const receipt = { ...((current?.receipt_settings as Record<string, unknown>) ?? {}) }
  delete receipt.show_qr
  delete receipt.qr_code_image_url
  const { error } = await db
    .from('branches')
    .update({ receipt_settings: receipt as Json, line_bot_user_id: null, print_server_working_hours: null, print_server_printer_name: null })
    .eq('id', branchId)
  expect(error, error?.message).toBeNull()
}
