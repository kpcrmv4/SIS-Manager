'use client'

import { useTranslations } from 'next-intl'

/**
 * Monday…Sunday on/off chips. A chip shows the day's full name where the row has room for all
 * seven and the short one (จ อ พ พฤ ศ ส อา) where it has not — a phone, a dialog (owner).
 * Screen readers always hear the full name.
 */
export function DayToggles({ label, isOn, onToggle }: { label: string; isOn: (day: number) => boolean; onToggle: (day: number) => void }) {
  const full: string[] = useTranslations('settingsBranch').raw('weekdaysLong')
  const short: string[] = useTranslations('settingsBooking').raw('weekdays')
  return (
    <div className="days" role="group" aria-label={label}>
      {full.map((name, i) => (
        <button key={name} type="button" aria-pressed={isOn(i)} aria-label={name} onClick={() => onToggle(i)} data-day={i}>
          <span className="day-short">{short[i]}</span>
          <span className="day-full">{name}</span>
        </button>
      ))}
    </div>
  )
}
