import { Skeleton } from '@/components/ui/states'

/** Same shape as <LineSettings>: header, then the channel card, webhook card and group card. */
export default function Loading() {
  return (
    <div aria-busy="true">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[5, 2, 3].map((rows, i) => (
          <div key={i} className="card-surface space-y-3 p-4">
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: rows }).map((_, j) => (
              <Skeleton key={j} className="h-10 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
