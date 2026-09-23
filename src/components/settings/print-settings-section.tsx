import { getTranslations } from 'next-intl/server'
import { getSupabaseServer } from '@/lib/supabase/server'
import { RefreshRetry } from '@/components/booking/refresh-retry'
import { getPrintStatus, type PrintWorkingHours } from '@/lib/print/actions'
import { PrintSettingsForm } from './print-settings-form'
import { PrintStatusPanel } from './print-status-panel'

/**
 * "เครื่องพิมพ์" section of /settings/branch (P3-B1). Fetches its own data so a failure
 * here does not take down the rest of the branch settings page (which already rendered
 * from its own query in page.tsx).
 */
export async function PrintSettingsSection({ branchId, branchCode }: { branchId: string; branchCode: string }) {
  const t = await getTranslations('print')
  const sb = await getSupabaseServer()

  const [{ data: branch, error: branchError }, statusRes] = await Promise.all([
    sb.from('branches').select('receipt_settings, line_bot_user_id, print_server_working_hours, print_server_printer_name').eq('id', branchId).maybeSingle(),
    getPrintStatus(branchId),
  ])

  if (branchError || !branch) {
    return (
      <>
        <div className="sec-head">{t('sectionTitle')}</div>
        <RefreshRetry />
      </>
    )
  }

  const receipt = (branch.receipt_settings ?? {}) as { show_qr?: boolean; qr_code_image_url?: string }

  return (
    <div className="flex flex-col gap-4">
      <PrintSettingsForm
        branchId={branchId}
        initial={{
          showQr: Boolean(receipt.show_qr),
          qrCodeImageUrl: receipt.qr_code_image_url ?? null,
          hasLineOa: Boolean(branch.line_bot_user_id),
          workingHours: (branch.print_server_working_hours as PrintWorkingHours | null) ?? null,
          printerName: branch.print_server_printer_name,
        }}
      />
      {/* a failed status load is an error state, never "no jobs" */}
      {!statusRes.ok && <RefreshRetry />}
      <PrintStatusPanel branchId={branchId} branchCode={branchCode} initialJobs={statusRes.ok ? statusRes.data.jobs : []} />
    </div>
  )
}
