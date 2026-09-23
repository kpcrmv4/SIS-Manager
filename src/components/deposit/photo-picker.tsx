'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Camera, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { uploadDepositPhoto } from '@/lib/photos'

/**
 * Camera/file capture → compressed upload to the private bucket, one chip per stored
 * path. No preview thumbnail (the bucket is private; a signed URL round trip per photo
 * is not worth it for a receipt photo the user just took), just a numbered chip with delete.
 */
export function PhotoPicker({
  branchId,
  paths,
  onChange,
  addLabel,
  helpText,
  testId,
}: {
  branchId: string
  paths: string[]
  onChange: (paths: string[]) => void
  addLabel: string
  helpText?: string
  testId?: string
}) {
  const tc = useTranslations('common')
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return
    setBusy(true)
    const next = [...paths]
    for (const file of Array.from(files)) {
      const res = await uploadDepositPhoto(branchId, file)
      if ('error' in res) toast.error(res.error)
      else next.push(res.path)
    }
    onChange(next)
    setBusy(false)
    if (input.current) input.current.value = ''
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {paths.map((p, i) => (
          <span key={p} className="chip text-ink-2 bg-surface-2 ring-line-strong" data-testid="photo-chip">
            {i + 1}
            <button type="button" onClick={() => onChange(paths.filter((x) => x !== p))} aria-label={tc('delete')}>
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()} data-testid={testId}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
          {addLabel}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {helpText && <p className="help-text">{helpText}</p>}
    </div>
  )
}
