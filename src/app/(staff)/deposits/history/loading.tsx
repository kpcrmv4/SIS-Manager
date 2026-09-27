import { ListSkeleton, MetricSkeleton, Skeleton } from '@/components/ui/states'

/** Same bones as the page: header, the three totals, the kinds, the filter, the events. */
export default function DepositHistoryLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-5 h-4 w-72" />
      <MetricSkeleton count={3} />
      <Skeleton className="mb-3 h-10 w-full" />
      <Skeleton className="mb-5 h-32 w-full" />
      <ListSkeleton rows={6} />
    </div>
  )
}
