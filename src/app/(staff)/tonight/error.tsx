'use client'

import { useRouter } from 'next/navigation'
import { ErrorRetry } from '@/components/ui/error-retry'

/** getTonightData throws when any of its queries fails — show retry, never an empty board. */
export default function TonightError({ reset }: { error: Error; reset: () => void }) {
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
