'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, RotateCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { ListRow } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/states'
import { PrintStatusBadge } from '@/components/print/print-status-badge'
import { getPrintStatus, requeuePrintJob, type PrintJobRow } from '@/lib/print/actions'
import { formatShortDate, formatTime, type AppLocale } from '@/lib/date'

const JOB_TONE: Record<PrintJobRow['status'], BadgeTone> = { pending: 'pending', printing: 'progress', completed: 'done', failed: 'urgent' }

/** Owner: status indicator + last 20 print jobs for the branch, with "พิมพ์ใหม่" on failed ones + the print-server setup download. */
export function PrintStatusPanel({ branchId, branchCode, initialJobs }: { branchId: string; branchCode: string; initialJobs: PrintJobRow[] }) {
  const t = useTranslations('print')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const locale = useLocale() as AppLocale
  const [jobs, setJobs] = useState(initialJobs)
  const [refreshKey, setRefreshKey] = useState(0)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const [, start] = useTransition()

  async function refresh() {
    const res = await getPrintStatus(branchId)
    if (res.ok) setJobs(res.data.jobs)
    setRefreshKey((k) => k + 1)
  }

  function retry(jobId: string) {
    setRetryingId(jobId)
    start(async () => {
      const res = await requeuePrintJob(jobId)
      setRetryingId(null)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('queued'))
      await refresh()
    })
  }

  async function runSetup() {
    setConfirmOpen(false)
    setSettingUp(true)
    try {
      const res = await fetch('/api/print-server/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error === 'unauthenticated' ? te('unauthenticated') : t('setupErrorGeneric'))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `print-server-${branchCode}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(t('setupDownloaded'))
      await refresh()
    } catch {
      toast.error(te('unknown'))
    } finally {
      setSettingUp(false)
    }
  }

  const typeLabel = (type: PrintJobRow['type']) => (type === 'receipt' ? t('receiptTitle') : t('labelTitle'))
  const statusLabel = (s: PrintJobRow['status']) => t(`status${s.charAt(0).toUpperCase()}${s.slice(1)}` as 'statusPending' | 'statusPrinting' | 'statusCompleted' | 'statusFailed')
  const when = (iso: string) => `${formatShortDate(iso, locale)} ${formatTime(iso, locale)}`

  return (
    <div className="card-surface flex flex-col gap-4 p-4" data-testid="print-status-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="sec-head mb-0!">{t('statusTitle')}</span>
          <PrintStatusBadge branchId={branchId} refreshKey={refreshKey} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={refresh} data-testid="print-status-refresh">
            <RotateCw className="size-4" aria-hidden />
            {tc('retry')}
          </button>
          <button type="button" className="btn-secondary btn-sm" disabled={settingUp} onClick={() => setConfirmOpen(true)} data-testid="print-setup-button">
            {settingUp ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Settings2 className="size-4" aria-hidden />}
            {t('setupButton')}
          </button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <EmptyState message={t('noJobs')} />
      ) : (
        <>
          <div className="panel hidden overflow-x-auto nav:block" data-testid="print-jobs-desktop">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('jobType')}</th>
                  <th>{t('jobCode')}</th>
                  <th>{t('jobStatus')}</th>
                  <th>{t('jobTime')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} data-testid="print-job-row">
                    <td>{typeLabel(j.type)}</td>
                    <td className="code">{j.code ?? '—'}</td>
                    <td>
                      <Badge tone={JOB_TONE[j.status]}>{statusLabel(j.status)}</Badge>
                      {j.status === 'failed' && j.errorMessage && <p className="help-text">{j.errorMessage}</p>}
                    </td>
                    <td className="tnum text-sm">{when(j.createdAt)}</td>
                    <td>
                      {j.status === 'failed' && !j.superseded && (
                        <button type="button" className="btn-ghost btn-sm" disabled={retryingId === j.id} onClick={() => retry(j.id)} data-testid="print-job-retry">
                          {retryingId === j.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
                          {t('retryJob')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel nav:hidden" data-testid="print-jobs-mobile">
            {jobs.map((j) => (
              <ListRow
                key={j.id}
                title={`${typeLabel(j.type)} · ${j.code ?? '—'}`}
                meta={when(j.createdAt)}
                aside={
                  <>
                    <Badge tone={JOB_TONE[j.status]}>{statusLabel(j.status)}</Badge>
                    {j.status === 'failed' && !j.superseded && (
                      <button type="button" className="btn-ghost btn-sm" disabled={retryingId === j.id} onClick={() => retry(j.id)} data-testid="print-job-retry">
                        {retryingId === j.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
                        {t('retryJob')}
                      </button>
                    )}
                  </>
                }
              />
            ))}
          </div>
        </>
      )}

      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-black/45" />
          <Dialog.Content
            aria-describedby="print-setup-confirm-desc"
            className="fixed left-1/2 top-1/2 z-31 w-[92vw] max-w-105 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-5 text-ink shadow-e2"
          >
            <Dialog.Title className="mb-2 text-base font-semibold text-ink">{t('setupButton')}</Dialog.Title>
            <p id="print-setup-confirm-desc" className="mb-4 text-sm text-muted-token">
              {t('setupConfirmBody')}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setConfirmOpen(false)}>
                {tc('cancel')}
              </button>
              <button type="button" className="btn-primary" onClick={runSetup} data-testid="print-setup-confirm">
                {tc('confirm')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
