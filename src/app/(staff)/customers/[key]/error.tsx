'use client'

import { ErrorRetry } from '@/components/ui/error-retry'

/** A failed read of one customer: retry renders the page again. */
export default function CustomerError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorRetry onRetry={reset} />
}
