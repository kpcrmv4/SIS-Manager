import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * `EmptyState` (ui kit) takes one `message: string` — a tab's empty state needs a title
 * AND a body line from the catalog (deposits.empty* + deposits.empty*Body), so this is a
 * two-line variant with the same visual shape, kept local since `components/ui` is read-only.
 */
export function EmptyTab({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="panel px-6 py-12 text-center">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-muted-token ring-1 ring-inset ring-line">
        <Inbox className="size-5" strokeWidth={1.8} aria-hidden />
      </span>
      <p className="mx-auto mb-1 max-w-[46ch] text-base font-semibold leading-6 text-ink">{title}</p>
      {body && <p className="mx-auto mb-4 max-w-[46ch] text-sm leading-5 text-muted-token">{body}</p>}
      {action}
    </div>
  )
}
