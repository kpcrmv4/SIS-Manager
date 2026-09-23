import { ListSkeleton, Skeleton } from '@/components/ui/states'

export default function ReportsLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-5 h-8 w-40" />
      <Skeleton className="mb-5 h-24 w-full" />
      <ListSkeleton rows={3} />
    </div>
  )
}
