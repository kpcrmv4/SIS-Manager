import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseServer } from '@/lib/supabase/server'
import { BookingSettingsForm, type BookingSettingsValue } from '@/components/settings/booking-settings-form'
import { BookingCalendar } from '@/components/settings/booking-calendar'
import { RefreshRetry } from '@/components/booking/refresh-retry'

// Built in P2-B3.
export default async function SettingsBookingPage() {
  const t = await getTranslations('settingsBooking')
  const tn = await getTranslations('nav')
  const state = await getActorState()
  if (state.status !== 'ok') return null
  const branch = state.actor.branch
  if (!branch) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState message={tn('switchBranch')} />
      </>
    )
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('booking_settings')
    .select('line_enabled, auto_confirm, advance_days, cutoff_time, slot_start, slot_end, slot_minutes, max_bookings_per_night, party_min, party_max, no_show_minutes, customer_cancel_hours, closed_weekdays')
    .eq('branch_id', branch.id)
    .maybeSingle()

  if (error || !data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <RefreshRetry />
      </>
    )
  }

  const initial: BookingSettingsValue = {
    lineEnabled: data.line_enabled,
    autoConfirm: data.auto_confirm,
    advanceDays: data.advance_days,
    cutoffTime: data.cutoff_time,
    slotStart: data.slot_start,
    slotEnd: data.slot_end,
    slotMinutes: data.slot_minutes,
    maxBookingsPerNight: data.max_bookings_per_night,
    partyMin: data.party_min,
    partyMax: data.party_max,
    noShowMinutes: data.no_show_minutes,
    customerCancelHours: data.customer_cancel_hours,
    closedWeekdays: data.closed_weekdays,
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle', { branch: branch.name })} />
      <div className="grid grid-cols-1 gap-4 nav:grid-cols-2">
        <BookingSettingsForm branchId={branch.id} initial={initial} />
        <BookingCalendar branchId={branch.id} locale={state.actor.locale} />
      </div>
    </>
  )
}
