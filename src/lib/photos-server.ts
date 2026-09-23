import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'

/**
 * Short-lived signed URLs for private deposit photos, as the signed-in user —
 * the storage policy only signs paths inside the user's branches.
 */
export async function signedPhotoUrls(paths: string[], seconds = 600): Promise<Record<string, string>> {
  const list = paths.filter(Boolean).slice(0, 50)
  if (!list.length) return {}
  const sb = await getSupabaseServer()
  const { data, error } = await sb.storage.from('deposit-photos').createSignedUrls(list, seconds)
  if (error || !data) return {}
  const out: Record<string, string> = {}
  for (const row of data) if (row.path && row.signedUrl) out[row.path] = row.signedUrl
  return out
}
