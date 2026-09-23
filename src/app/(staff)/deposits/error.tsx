'use client'

import { useRouter } from 'next/navigation'
import { ErrorRetry } from '@/components/ui/error-retry'

/**
 * Pairs with the fault-injection guard in page.tsx (P2-A1-11). Retry clears the query
 * string (not just `reset()`, which would re-render the same failing searchParams) so the
 * click actually recovers into the real list instead of failing forever.
 */
export default function DepositsError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter()
  return (
    <ErrorRetry
      onRetry={() => {
        router.push('/deposits')
        reset()
      }}
    />
  )
}
