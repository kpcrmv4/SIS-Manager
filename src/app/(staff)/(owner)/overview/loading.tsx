import { ListSkeleton, Skeleton } from '@/components/ui/states'

/** Same bones as the page: header, the ต้องจัดการ strip, five figures, tonight + activity, branches. */
export default function OverviewLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-5 h-4 w-72" />
      <Skeleton className="mb-5 h-11 w-full" />
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className={`h-32 rounded-none ${i === 4 ? 'col-span-2 lg:col-span-1' : ''}`} />
        ))}
      </div>
      <div className="mb-5 grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-64 xl:col-span-7" />
        <div className="xl:col-span-5">
          <ListSkeleton rows={5} />
        </div>
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
