import { Skeleton } from '@/components/ui/states'

/** Same bones as the page: header, filter, two figure groups, two charts, the lists. */
export default function ReportsLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-2 h-8 w-40" />
      <Skeleton className="mb-5 h-4 w-64" />
      <Skeleton className="mb-5 h-36 w-full" />
      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-60" />
        <Skeleton className="h-60" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  )
}
