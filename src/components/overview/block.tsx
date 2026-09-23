import type { ReactNode } from 'react'

/** A titled card on the overview: header row (title + an aside such as a hint or a link), then the body. */
export function Block({
  title,
  aside,
  children,
  className = '',
  bodyClassName = 'p-4',
  testId,
  id,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  testId?: string
  id?: string
}) {
  return (
    <section id={id} aria-label={title} className={`panel flex scroll-mt-4 flex-col ${className}`} data-testid={testId}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5">
        <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        {aside && <div className="flex shrink-0 items-center gap-2 text-xs text-muted-token">{aside}</div>}
      </header>
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  )
}
