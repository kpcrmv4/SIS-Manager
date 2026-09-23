'use client'

import { useRouter } from 'next/navigation'
import { ErrorRetry } from '@/components/ui/error-retry'

/** ErrorRetry wired to router.refresh() — the retry Server Components reach for. */
export function RefreshRetry() {
  const router = useRouter()
  return <ErrorRetry onRetry={() => router.refresh()} />
}
