'use client'

import { RotateCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * The one interactive piece of the four states, kept in its OWN file so that
 * `states.tsx` can stay a Server Component and accept icon props.
 * See the note at the top of states.tsx.
 *
 * Pair with `error.tsx` at the segment level:
 *
 *   // app/(app)/orders/error.tsx
 *   'use client'
 *   export default function Error({ reset }: { error: Error; reset: () => void }) {
 *     return <ErrorRetry onRetry={reset} />
 *   }
 *
 * 🔴 An `error.tsx` boundary renders with HTTP **200**. A sweep that only checks
 * status codes will report a page as healthy while every visitor sees this card.
 * Assert on content, not on the response code.
 */
export function ErrorRetry({
  onRetry,
  message,
  retryLabel,
}: {
  onRetry: () => void
  message?: string
  retryLabel?: string
}) {
  const t = useTranslations('common')
  return (
    <div role="alert" className="panel px-6 py-10 text-center">
      <p className="mb-1 text-base font-semibold leading-6 text-ink">{message ?? t('errorTitle')}</p>
      {!message && <p className="mb-4 text-sm text-muted-token">{t('errorBody')}</p>}
      <button type="button" onClick={onRetry} className="btn-secondary mx-auto mt-3">
        <RotateCw className="size-4" aria-hidden />
        {retryLabel ?? t('retry')}
      </button>
    </div>
  )
}
