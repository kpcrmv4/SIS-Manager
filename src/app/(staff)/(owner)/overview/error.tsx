'use client'

import { useRouter } from 'next/navigation'
import { ErrorRetry } from '@/components/ui/error-retry'

export default function OverviewError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter()
  return (
    <ErrorRetry
      onRetry={() => {
        router.refresh()
        reset()
      }}
    />
  )
}
