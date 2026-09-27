'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

/**
 * A filter form folded on a phone (owner, 2026-09-27: the forms of รายงาน, บันทึกการใช้งาน and
 * ประวัติฝาก/เบิก filled the screen before any content). Below `nav:` one line says what is
 * chosen and unfolds the form; from `nav:` up the form is always open and the line is gone.
 */
export function FilterDisclosure({ label, summary, children, testId }: { label: string; summary: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-testid={testId} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-line bg-card px-3 py-2.5 text-left text-sm shadow-e1 nav:hidden"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <SlidersHorizontal className="size-4 flex-none text-muted-token" aria-hidden />
        <span className="flex-none font-semibold text-ink">{label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-token">{summary}</span>
        <ChevronDown className={`size-4 flex-none text-muted-token transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div className={`${open ? 'mt-2 block' : 'hidden'} nav:mt-0 nav:block`}>{children}</div>
    </div>
  )
}
