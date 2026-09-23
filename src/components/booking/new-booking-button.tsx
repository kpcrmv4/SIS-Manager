'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { BookingFormDialog, type BookingSettingsForForm } from './booking-form-dialog'
import type { ZoneRow } from '@/lib/booking/queries'

/** The รับจอง trigger in the page header + its dialog, together so the header stays data-free. */
export function NewBookingButton({
  branchId,
  night,
  zones,
  settings,
}: {
  branchId: string
  night: string
  zones: ZoneRow[]
  settings: BookingSettingsForForm
}) {
  const t = useTranslations('bookings')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)} data-testid="new-booking-button">
        <Plus className="size-4" aria-hidden />
        {t('new')}
      </button>
      <BookingFormDialog
        open={open}
        onOpenChange={setOpen}
        branchId={branchId}
        night={night}
        zones={zones}
        settings={settings}
        onCreated={() => router.refresh()}
      />
    </>
  )
}
