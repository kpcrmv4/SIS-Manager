'use client'

import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLocale, useTranslations } from 'next-intl'
import type { CustomerLocale } from '@/lib/i18n/config'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { formatLongDate } from '@/lib/date'
import { CxEmpty, CxErrorRetry, CxLoader } from './cx-states'
import { errorText } from './error-text'
import { useCxPortal } from './portal'
import { customerFetch, useCxSession } from './session-context'
import { focusDialogItself } from '@/lib/dialog-focus'

type Booking = {
  id: string
  code: string
  night: string
  slotTime: string
  arriveBy: string | null
  party: number
  zone: string | null
  table: string | null
  name: string
  phone: string | null
  note: string | null
  status: string
  qrToken: string
  cancellable: boolean
}

const SUB_KEY: Record<string, string> = {
  confirmed: 'confirmedSub',
  pending: 'pendingSub',
  arrived: 'arrivedSub',
  cancelled: 'cancelledSub',
  rejected: 'rejectedSub',
  no_show: 'noShowSub',
}
const QR_STATUSES = new Set(['confirmed', 'arrived'])
const CANCELLABLE_STATUS = new Set(['pending', 'confirmed'])

/** "รายการจองของคุณ" (P2-C3): code, QR of the token (never the code), rows, cancel. */
export function TicketClient({ code }: { code: string }) {
  const t = useTranslations('cx')
  // dates follow the language on screen (the session's locale is only the one at sign-in)
  const locale = useLocale() as CustomerLocale
  const session = useCxSession()
  const portal = useCxPortal()
  const [state, setState] = useState<'loading' | 'error' | 'empty' | 'ready'>('loading')
  const [booking, setBooking] = useState<Booking | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const load = useCallback(() => {
    setState('loading')
    customerFetch(`/api/customer/bookings?branch=${session.branch.code}&code=${encodeURIComponent(code)}`, session)
      .then(async (res) => {
        if (res.status === 404) {
          setState('empty')
          return
        }
        if (!res.ok) throw new Error('load failed')
        const d = (await res.json()) as { booking: Booking }
        setBooking(d.booking)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [session, code])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  useEffect(() => {
    if (!booking || !QR_STATUSES.has(booking.status)) {
      // Resets the derived QR image when the booking isn't in a QR-eligible status —
      // synchronizing with the qrcode library below, not reacting to our own render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQr(null)
      return
    }
    let cancelled = false
    // margin 4 modules (ISO/IEC 18004's recommended quiet zone) — a thinner margin scans
    // unreliably for real phone cameras, not just this test's decoder
    QRCode.toDataURL(booking.qrToken, { margin: 4, width: 172 })
      .then((url) => {
        if (!cancelled) setQr(url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [booking])

  const doCancel = async () => {
    if (!booking) return
    setPending(true)
    try {
      const res = await customerFetch(`/api/customer/bookings/${booking.id}/cancel?branch=${session.branch.code}`, session, { method: 'POST', body: '{}' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(errorText(t, body.error))
        return
      }
      toast.success(t('ticket.cancelled'))
      setConfirmOpen(false)
      load()
    } catch {
      toast.error(t('shell.errorGeneric'))
    } finally {
      setPending(false)
    }
  }

  if (state === 'loading') return <CxLoader label={t('shell.loading')} />
  if (state === 'error') return <CxErrorRetry message={t('shell.errorGeneric')} onRetry={load} />
  if (state === 'empty' || !booking) return <CxEmpty title={t('ticket.notFound')} />

  const b = booking
  return (
    <div className="flex flex-col gap-3">
      <div className="ticket" data-testid="cx-ticket" data-status={b.status}>
        <div className="tt">
          <div className="text-xs text-cx-muted">{t('ticket.number')}</div>
          <div className="no num">{b.code}</div>
          {qr ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a data: URL, no next/image optimization applies */
            <img className="qr" src={qr} alt={t('ticket.number')} data-testid="cx-ticket-qr" />
          ) : (
            <p className="py-6 text-xs text-cx-muted" data-testid="cx-ticket-pending-qr">
              {t('ticket.pendingQr')}
            </p>
          )}
          <div className="text-xs text-cx-muted">{t('ticket.scanHint')}</div>
        </div>
        <div className="tear" />
        <div className="rows num">
          <span>{t('ticket.date')}</span>
          <span data-testid="cx-ticket-date">{formatLongDate(b.night, locale)}</span>
          <span>{t('ticket.time')}</span>
          <span>{b.arriveBy ? t('ticket.timeValue', { time: b.slotTime, until: b.arriveBy }) : b.slotTime}</span>
          <span>{t('ticket.party')}</span>
          <span>{b.zone ? t('ticket.partyValue', { count: b.party, zone: b.zone }) : t('ticket.partyNoZone', { count: b.party })}</span>
          <span>{t('ticket.name')}</span>
          <span>{b.name}</span>
          {b.table && (
            <>
              <span>{t('ticket.table')}</span>
              <span>{b.table}</span>
            </>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-cx-muted">{t(`ticket.${SUB_KEY[b.status] ?? 'pendingSub'}`)}</p>

      {CANCELLABLE_STATUS.has(b.status) && (
        <>
          <button
            type="button"
            className="cx-btn ghost"
            disabled={!b.cancellable}
            onClick={() => setConfirmOpen(true)}
            data-testid="cx-ticket-cancel"
          >
            {t('ticket.cancel')}
          </button>
          {!b.cancellable && <p className="text-center text-[11.5px] text-cx-muted">{t('ticket.cancelTooLate')}</p>}
        </>
      )}

      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal container={portal}>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-cx-scrim" />
          <Dialog.Content onOpenAutoFocus={focusDialogItself}
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-31 w-[calc(100%-2rem)] max-w-85 -translate-x-1/2 -translate-y-1/2 rounded-[18px] border border-cx-line-strong bg-cx-sheet p-4 text-cx-ink shadow-[0_20px_50px_rgba(0,0,0,.45)]"
            data-testid="cx-ticket-cancel-dialog"
          >
            <Dialog.Title className="cx-serif mb-3 text-[15px] font-semibold">{t('ticket.cancelConfirm')}</Dialog.Title>
            <div className="flex gap-2">
              <button type="button" className="cx-btn ghost flex-1" onClick={() => setConfirmOpen(false)}>
                {t('shell.close')}
              </button>
              <button type="button" className="cx-btn danger flex-1" disabled={pending} onClick={() => void doCancel()} data-testid="cx-ticket-cancel-confirm">
                {t('ticket.cancel')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
