import { ListSkeleton, Skeleton } from '@/components/ui/states'

/**
 * Same bones as the list: header, the four cards, the search, the rows. It lives in the (list)
 * group so it never wraps /customers/[key], which 404s and redirects (verify-route-guards).
 */
export default function CustomersLoading() {
  return (
    <div aria-busy="true" data-testid="customers-skeleton">
      <Skeleton className="mb-2 h-8 w-40" />
      <Skeleton className="mb-5 h-4 w-64" />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[84px]" />
        ))}
      </div>
      <Skeleton className="mb-4 h-10 w-full" />
      <ListSkeleton rows={6} />
    </div>
  )
}
