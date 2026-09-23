'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { addDays } from '@/lib/date'
import { hrefWith } from '@/components/ui/filter-href'

/** `?night=YYYY-MM-DD` — prev/next day + a direct jump, all via the URL. */
export function NightPicker({ night, params }: { night: string; params: Record<string, string | undefined> }) {
  const router = useRouter()
  const t = useTranslations('common')
  const tf = useTranslations('bookingForm')
  const go = (n: string) => router.push(hrefWith('/bookings', params, { night: n }))

  return (
    <div className="inline-flex items-center gap-1 rounded-[10px] border border-line bg-card px-1 py-1">
      <button type="button" className="btn-ghost btn-sm" aria-label={t('previous')} onClick={() => go(addDays(night, -1))}>
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <input
        type="date"
        value={night}
        aria-label={tf('night')}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="w-[130px] rounded-sm bg-transparent px-1 py-1 text-sm tnum outline-none"
      />
      <button type="button" className="btn-ghost btn-sm" aria-label={t('next')} onClick={() => go(addDays(night, 1))}>
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  )
}
