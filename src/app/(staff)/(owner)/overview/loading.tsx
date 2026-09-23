import { ListSkeleton, MetricSkeleton, Skeleton } from '@/components/ui/states'

export default function OverviewLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-5 h-8 w-56" />
      <MetricSkeleton count={4} />
      <ListSkeleton rows={3} />
    </div>
  )
}
