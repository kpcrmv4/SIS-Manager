'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

/** Copies a text to the clipboard and says so. */
export function CopyButton({ text, label, done, testId }: { text: string; label: string; done: string; testId?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setOk(true)
          toast.success(done)
          window.setTimeout(() => setOk(false), 2000)
        } catch {
          toast.error(text)
        }
      }}
      data-testid={testId}
    >
      {ok ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {label}
    </button>
  )
}
