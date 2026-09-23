'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, CheckCircle2, Loader2, Printer, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { queuePrint, type PrintJobType } from '@/lib/deposit/print'
import { getPrintStatus, type PrintStatusView } from '@/lib/print/actions'
import { ActionDialog } from './action-dialog'

type Check = PrintStatusView['state'] | 'unknown'

/**
 * Any role: enqueue a receipt or label print job. Every click first checks the branch's
 * print-server heartbeat and asks to confirm — a warning when it is not running (the job
 * still queues and prints once the shop PC is on).
 */
export function PrintButtons({ depositId, branchId, code }: { depositId: string; branchId: string; code: string }) {
  const t = useTranslations('deposit')
  const tp = useTranslations('print')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [checking, setChecking] = useState<PrintJobType | null>(null)
  const [ask, setAsk] = useState<{ type: PrintJobType; state: Check } | null>(null)
  const [pending, start] = useTransition()

  async function open(type: PrintJobType) {
    setChecking(type)
    try {
      const res = await getPrintStatus(branchId)
      setAsk({ type, state: res.ok ? res.data.state : 'unknown' })
    } catch {
      setAsk({ type, state: 'unknown' })
    } finally {
      setChecking(null)
    }
  }

  function go() {
    if (!ask) return
    const { type } = ask
    start(async () => {
      const res = await queuePrint(depositId, type)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      setAsk(null)
      toast.success(t('printed'))
    })
  }

  const busy = checking !== null || pending
  const online = ask?.state === 'online'
  const warning = ask && !online ? tp(ask.state === 'offline' ? 'warnOffline' : ask.state === 'not_set_up' ? 'warnNotSetUp' : 'warnUnknown') : null

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => void open('receipt')} disabled={busy} data-testid="print-receipt">
        {checking === 'receipt' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
        {t('actionPrint')}
      </button>
      <button type="button" className="btn-secondary" onClick={() => void open('label')} disabled={busy} data-testid="print-label">
        {checking === 'label' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Tag className="size-4" aria-hidden />}
        {t('actionPrintLabel')}
      </button>

      <ActionDialog
        open={ask !== null}
        onOpenChange={(v) => !v && !pending && setAsk(null)}
        title={tp(ask?.type === 'label' ? 'confirmTitleLabel' : 'confirmTitleReceipt')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAsk(null)} disabled={pending}>
              {tc('cancel')}
            </button>
            <button type="button" className="btn-primary" onClick={go} disabled={pending} data-testid="print-confirm">
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {online ? tp('confirmPrint') : tp('confirmQueueAnyway')}
            </button>
          </>
        }
      >
        {online ? (
          <p className="flex items-start gap-2 text-sm text-ink" data-testid="print-ready">
            <CheckCircle2 className="mt-0.5 size-4 flex-none text-status-done" aria-hidden />
            {tp('confirmReady', { code })}
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border border-urgent-ring bg-urgent-bg p-3 text-sm text-urgent" role="alert" data-testid="print-offline-warning">
            <AlertTriangle className="mt-0.5 size-4 flex-none" aria-hidden />
            {warning}
          </p>
        )}
      </ActionDialog>
    </>
  )
}
