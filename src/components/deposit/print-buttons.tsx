'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Printer, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { queuePrint, type PrintJobType } from '@/lib/deposit/print'

/** Any role: enqueue a receipt or label print job (print-server picks it up — P3 scope). */
export function PrintButtons({ depositId }: { depositId: string }) {
  const t = useTranslations('deposit')
  const te = useTranslations('errors')
  const [pending, start] = useTransition()

  function go(type: PrintJobType) {
    start(async () => {
      const res = await queuePrint(depositId, type)
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('printed'))
    })
  }

  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => go('receipt')} disabled={pending} data-testid="print-receipt">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
        {t('actionPrint')}
      </button>
      <button type="button" className="btn-ghost" onClick={() => go('label')} disabled={pending} data-testid="print-label">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Tag className="size-4" aria-hidden />}
        {t('actionPrintLabel')}
      </button>
    </>
  )
}
