'use client'

import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { bangkokDate } from '@/lib/date'

export const PHOTO_BUCKET = 'deposit-photos'

/**
 * Compress a camera photo in the browser, then upload it to the private bucket at
 * `<branchId>/<yyyy-mm>/<uuid>.jpg` — the folder is what the storage policy checks.
 * Returns the storage path (store paths in the DB, never public URLs).
 */
export async function uploadDepositPhoto(branchId: string, file: File): Promise<{ path: string } | { error: string }> {
  let blob: Blob = file
  try {
    // loaded on first upload only — keeps the compression worker out of every detail-page bundle
    const { default: imageCompression } = await import('browser-image-compression')
    blob = await imageCompression(file, { maxWidthOrHeight: 1600, maxSizeMB: 0.8, fileType: 'image/jpeg', useWebWorker: true })
  } catch {
    // an unsupported format falls through and is refused by the bucket's mime list
  }
  const month = bangkokDate().slice(0, 7) // Bangkok month, not the device/UTC one
  const path = `${branchId}/${month}/${crypto.randomUUID()}.jpg`
  const { error } = await getSupabaseBrowser().storage.from(PHOTO_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) return { error: error.message }
  return { path }
}
