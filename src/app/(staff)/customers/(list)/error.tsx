'use client'

import { useRouter } from 'next/navigation'
import { ErrorRetry } from '@/components/ui/error-retry'

/** Retry drops the query string (a failing search would fail again) and reloads the list — as on /deposits. */
export default function CustomersError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter()
  return (
    <ErrorRetry
      onRetry={() => {
        router.push('/customers')
        reset()
      }}
    />
  )
}
