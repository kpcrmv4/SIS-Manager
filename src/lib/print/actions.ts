'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid, cleanText } from '@/lib/action'
import type { ActionResult } from '@/lib/errors'
import type { Database } from '@/types/database'
import { queuePrint, type PrintJobType } from '@/lib/deposit/print'
import { lineAddFriendUrl, pngDataUrl } from './qr'

type BranchUpdate = Database['public']['Tables']['branches']['Update']
type PrintStatus = Database['public']['Enums']['print_status']

export type PrintWorkingHours = { enabled: boolean; startHour: number; startMinute: number; endHour: number; endMinute: number }

export type PrintSettingsInput = {
  showQr?: boolean
  workingHours?: PrintWorkingHours
  printerName?: string
}

export type PrintSettingsView = {
  showQr: boolean
  qrCodeImageUrl: string | null
  hasLineOa: boolean
  workingHours: PrintWorkingHours | null
  printerName: string | null
}

function isWorkingHours(v: unknown): v is PrintWorkingHours {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const hour = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 23
  const minute = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 59
  return typeof o.enabled === 'boolean' && hour(o.startHour) && minute(o.startMinute) && hour(o.endHour) && minute(o.endMinute)
}

/**
 * Owner: the "เครื่องพิมพ์" section of /settings/branch — the receipt QR (built from the
 * branch's LINE OA add-friend link, never the deposit QR), print-server working hours and
 * printer name. Session client — RLS (`branches` write: owner) is the only branch check;
 * an update that touches 0 rows means "not this branch's owner" (silent-refusal pattern,
 * same as src/lib/settings/branch-actions.ts).
 */
export async function updatePrintSettings(branchId: string, patch: PrintSettingsInput): Promise<ActionResult<PrintSettingsView>> {
  if (!isUuid(branchId)) return { ok: false, error: 'invalid' }
  if (patch.workingHours !== undefined && !isWorkingHours(patch.workingHours)) return { ok: false, error: 'invalid' }
  if (patch.printerName !== undefined && patch.printerName !== '' && cleanText(patch.printerName, 60) === undefined) return { ok: false, error: 'invalid' }

  const sb = await getSupabaseServer()
  const { data: current, error: readError } = await sb
    .from('branches')
    .select('receipt_settings, line_bot_user_id, print_server_working_hours, print_server_printer_name')
    .eq('id', branchId)
    .maybeSingle()
  if (readError) return { ok: false, error: 'unknown' }
  if (!current) return { ok: false, error: 'FORBIDDEN' }

  const row: BranchUpdate = {}
  const existingReceipt = (current.receipt_settings ?? {}) as Record<string, unknown>

  if (patch.showQr !== undefined) {
    if (patch.showQr && !current.line_bot_user_id) return { ok: false, error: 'invalid' }
    const qrCodeImageUrl = patch.showQr ? await pngDataUrl(lineAddFriendUrl(current.line_bot_user_id as string)) : ((existingReceipt.qr_code_image_url as string | undefined) ?? null)
    row.receipt_settings = { ...existingReceipt, show_qr: patch.showQr, qr_code_image_url: qrCodeImageUrl }
  }
  if (patch.workingHours !== undefined) row.print_server_working_hours = patch.workingHours
  if (patch.printerName !== undefined) row.print_server_printer_name = cleanText(patch.printerName, 60) ?? null

  if (Object.keys(row).length === 0) return { ok: false, error: 'invalid' }

  const { data, error } = await sb.from('branches').update(row).eq('id', branchId).select('id').maybeSingle()
  if (error) return { ok: false, error: 'unknown' }
  if (!data) return { ok: false, error: 'FORBIDDEN' }

  revalidatePath('/settings/branch')

  const receipt = (row.receipt_settings as Record<string, unknown> | undefined) ?? existingReceipt
  return {
    ok: true,
    data: {
      showQr: Boolean(receipt.show_qr),
      qrCodeImageUrl: (receipt.qr_code_image_url as string | null | undefined) ?? null,
      hasLineOa: Boolean(current.line_bot_user_id),
      workingHours: (row.print_server_working_hours as PrintWorkingHours | undefined) ?? ((current.print_server_working_hours as PrintWorkingHours | null) ?? null),
      printerName: (row.print_server_printer_name as string | undefined) ?? current.print_server_printer_name,
    },
  }
}

export type PrintJobRow = {
  id: string
  type: PrintJobType
  code: string | null
  status: PrintStatus
  createdAt: string
  errorMessage: string | null
}

export type PrintStatusView = {
  state: 'online' | 'offline' | 'not_set_up'
  lastHeartbeat: string | null
  jobs: PrintJobRow[]
}

const ONLINE_WINDOW_MS = 2 * 60 * 1000

/** Station heartbeat + last 20 jobs for a branch — read by the owner's settings panel and the read-only badge on the deposit detail (staff/bar). RLS scopes both to branch members. */
export async function getPrintStatus(branchId: string): Promise<ActionResult<PrintStatusView>> {
  if (!isUuid(branchId)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()

  const [{ data: station, error: stationError }, { data: jobs, error: jobsError }] = await Promise.all([
    sb.from('print_stations').select('is_online, last_heartbeat').eq('branch_id', branchId).maybeSingle(),
    sb.from('print_jobs').select('id, job_type, status, payload, error_message, created_at').eq('branch_id', branchId).order('created_at', { ascending: false }).range(0, 19),
  ])
  if (stationError) return { ok: false, error: 'unknown' }
  if (jobsError) return { ok: false, error: 'unknown' }

  let state: PrintStatusView['state'] = 'not_set_up'
  if (station) {
    const fresh = station.last_heartbeat ? Date.now() - new Date(station.last_heartbeat).getTime() < ONLINE_WINDOW_MS : false
    state = station.is_online && fresh ? 'online' : 'offline'
  }

  return {
    ok: true,
    data: {
      state,
      lastHeartbeat: station?.last_heartbeat ?? null,
      jobs: (jobs ?? []).map((j) => ({
        id: j.id,
        type: j.job_type as PrintJobType,
        code: (j.payload as { deposit_code?: string } | null)?.deposit_code ?? null,
        status: j.status,
        createdAt: j.created_at,
        errorMessage: j.error_message,
      })),
    },
  }
}

/** "พิมพ์ใหม่" on a failed job — re-reads the deposit + type off the failed job and calls `queue_print` again (a fresh row; the failed one is left as a record). */
export async function requeuePrintJob(jobId: string): Promise<ActionResult<{ id: string }>> {
  if (!isUuid(jobId)) return { ok: false, error: 'invalid' }
  const sb = await getSupabaseServer()
  const { data: job, error } = await sb.from('print_jobs').select('deposit_id, job_type, copies, status').eq('id', jobId).maybeSingle()
  if (error) return { ok: false, error: 'unknown' }
  if (!job || job.status !== 'failed' || !job.deposit_id) return { ok: false, error: 'NOT_FOUND' }
  return queuePrint(job.deposit_id, job.job_type as PrintJobType, job.copies)
}
