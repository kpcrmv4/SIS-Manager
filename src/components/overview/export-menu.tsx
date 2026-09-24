import { ChevronDown, Download, FileText } from 'lucide-react'

/**
 * "ส่งออก ▾" — Excel and PDF behind one button (native <details>, no script). The links are
 * plain downloads of the report route for the chosen period (and branch). Lives on /reports.
 */
export function ExportMenu({
  label,
  excel,
  pdf,
  excelHref,
  pdfHref,
  testIdPrefix = 'reports-export',
}: {
  label: string
  excel: string
  pdf: string
  excelHref: string
  pdfHref: string
  testIdPrefix?: string
}) {
  return (
    <details className="group relative" data-testid={testIdPrefix}>
      <summary className="btn-secondary cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
        <Download className="size-4" aria-hidden />
        {label}
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="absolute right-0 z-30 mt-1.5 flex w-48 flex-col rounded-lg border border-line bg-card p-1 shadow-e2">
        <a className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-2" href={excelHref} data-testid={`${testIdPrefix}-xlsx`}>
          <Download className="size-4 text-muted-token" aria-hidden />
          {excel}
        </a>
        <a className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-2" href={pdfHref} data-testid={`${testIdPrefix}-pdf`}>
          <FileText className="size-4 text-muted-token" aria-hidden />
          {pdf}
        </a>
      </div>
    </details>
  )
}
