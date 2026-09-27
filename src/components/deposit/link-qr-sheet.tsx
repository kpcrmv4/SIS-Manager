'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Loader2, QrCode, RotateCw, UserCheck, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { issueLinkQr, linkQrStatus, revokeLinkQr, type LinkQr, type LinkQrStatus } from '@/lib/deposit/link-qr'
import { ActionDialog } from './action-dialog'

const POLL_MS = 2500

type View = { kind: 'loading' } | { kind: 'qr'; qr: LinkQr; image: string } | { kind: 'expired' } | { kind: 'linked'; status: LinkQrStatus }

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * R-058 · "ให้ลูกค้าสแกนผูก LINE": a one-time QR (10 minutes) the customer scans with the phone
 * camera. Before the QR it says whether this phone already has a LINE customer here or is new;
 * while open it asks every few seconds whether the customer has scanned, then says who linked and
 * how many deposits. Closing the sheet kills the QR. Rendered for every open deposit — linked or
 * not — so a refresh after the link keeps the sheet (and its result) on screen.
 */
export function LinkQrSheet({ depositId, linked, hasPhone }: { depositId: string; linked: boolean; hasPhone: boolean }) {
  const t = useTranslations('deposit.linkQr')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [now, setNow] = useState(() => Date.now())
  const live = useRef(false)

  const issue = useCallback(async () => {
    setView({ kind: 'loading' })
    const res = await issueLinkQr(depositId)
    if (!res.ok) {
      toast.error(te(res.error))
      setOpen(false)
      return
    }
    const { default: QRCode } = await import('qrcode')
    const image = await QRCode.toDataURL(res.data.url, { margin: 2, width: 560, errorCorrectionLevel: 'M' })
    live.current = true
    setNow(Date.now())
    setView({ kind: 'qr', qr: res.data, image })
  }, [depositId, te])

  function openSheet() {
    setOpen(true)
    void issue()
  }

  function close(next: boolean) {
    if (next) return
    setOpen(false)
    if (live.current) {
      live.current = false
      void revokeLinkQr(depositId)
    }
    if (view.kind === 'linked') router.refresh()
  }

  // while the QR is up: tick the countdown and ask whether the customer has scanned
  useEffect(() => {
    if (!open || view.kind !== 'qr') return
    const expiresAt = new Date(view.qr.expiresAt).getTime()
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(() => {
      void linkQrStatus(depositId).then((res) => {
        if (!res.ok) return
        if (res.data.linked) {
          live.current = false
          setView({ kind: 'linked', status: res.data })
        } else if (!res.data.live || Date.now() >= expiresAt) {
          live.current = false
          setView({ kind: 'expired' })
        }
      })
    }, POLL_MS)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [open, view, depositId])

  // leaving the page with the sheet open kills the QR too
  useEffect(() => {
    const kill = () => {
      if (live.current) void revokeLinkQr(depositId)
    }
    window.addEventListener('pagehide', kill)
    return () => {
      window.removeEventListener('pagehide', kill)
      kill()
    }
  }, [depositId])

  const left = view.kind === 'qr' ? new Date(view.qr.expiresAt).getTime() - now : 0
  const shownExpired = view.kind === 'expired' || (view.kind === 'qr' && left <= 0)

  return (
    <>
      {!linked && (
        <button type="button" className="btn-secondary btn-sm w-full" onClick={openSheet} data-testid="link-qr-open">
          <QrCode className="size-4" aria-hidden />
          {t('open')}
        </button>
      )}
      <ActionDialog
        open={open}
        onOpenChange={close}
        title={view.kind === 'linked' ? t('linkedTitle') : t('title')}
        footer={
          <button type="button" className={view.kind === 'linked' ? 'btn-primary' : 'btn-secondary'} onClick={() => close(false)} data-testid="link-qr-close">
            {view.kind === 'linked' ? t('done') : tc('close')}
          </button>
        }
      >
        <div data-testid="link-qr-sheet" data-state={shownExpired ? 'expired' : view.kind}>
          {view.kind === 'loading' && (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-token" role="status">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              {t('loading')}
            </div>
          )}

          {view.kind === 'qr' && !shownExpired && (
            <div className="flex flex-col items-center gap-3">
              <HistoryLine qr={view.qr} hasPhone={hasPhone} />
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made on this device */}
              <img src={view.image} alt="" width={280} height={280} className="size-[min(280px,70vw)] rounded-[12px] border border-line bg-white p-1" data-testid="link-qr-image" data-url={view.qr.url} />
              <p className="text-center text-sm text-ink-2">{t('body')}</p>
              <p className="text-xs text-muted-token tnum" data-testid="link-qr-countdown">
                {t('expiresIn', { time: mmss(left) })}
              </p>
              <p className="text-xs text-muted-token">{t('closeHint')}</p>
            </div>
          )}

          {shownExpired && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm font-semibold text-ink">{t('expired')}</p>
              <button type="button" className="btn-primary" onClick={() => void issue()} data-testid="link-qr-renew">
                <RotateCw className="size-4" aria-hidden />
                {t('renew')}
              </button>
            </div>
          )}

          {view.kind === 'linked' && (
            <div className="flex flex-col items-center gap-2 py-4 text-center" data-testid="link-qr-linked" data-returning={view.status.returning ? 'true' : 'false'}>
              <CheckCircle2 className="size-10 text-status-done" aria-hidden />
              <p className="text-[15px] font-semibold text-ink">
                {view.status.returning ? t('linkedReturning', { name: view.status.name ?? 'LINE' }) : t('linkedNew', { name: view.status.name ?? 'LINE' })}
              </p>
              <p className="text-sm text-muted-token tnum" data-testid="link-qr-count">
                {t('linkedCount', { count: view.status.count })}
              </p>
            </div>
          )}
        </div>
      </ActionDialog>
    </>
  )
}

/** Before the QR: has this phone a LINE customer here already (and who), or is it new. */
function HistoryLine({ qr, hasPhone }: { qr: LinkQr; hasPhone: boolean }) {
  const t = useTranslations('deposit.linkQr')
  const Icon = qr.known ? UserCheck : UserPlus
  const text = !hasPhone ? t('noPhone') : qr.known ? (qr.knownName ? t('known', { name: qr.knownName }) : t('knownNoName')) : t('isNew')
  return (
    <div className="w-full rounded-[10px] border border-line-soft bg-surface-2 px-3 py-2 text-sm" data-testid="link-qr-history" data-known={qr.known ? 'true' : 'false'}>
      <div className="flex items-center gap-2 text-ink">
        <Icon className="size-4 flex-none" aria-hidden />
        <span className="min-w-0">{text}</span>
      </div>
      {qr.also > 0 && (
        <p className="mt-1 text-xs text-muted-token" data-testid="link-qr-also">
          {t('also', { count: qr.also })}
        </p>
      )}
    </div>
  )
}
