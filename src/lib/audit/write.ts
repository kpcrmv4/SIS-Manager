import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

export type AuditActor = { id: string; displayName: string }

/**
 * An audit row written by the server (R-038) for a change the database cannot attribute: user
 * management and LINE keys go through the service role, so no one is signed in down there.
 * Best effort — a failed audit write never undoes the change it describes.
 */
export async function auditAs(
  actor: AuditActor,
  row: { category: 'users' | 'settings'; action: string; target: string | null; targetId?: string | null; branchId?: string | null; details?: Record<string, unknown> },
): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('audit_log')
    .insert({
      branch_id: row.branchId ?? null,
      actor_id: actor.id,
      actor_name: actor.displayName,
      actor_kind: 'staff',
      category: row.category,
      action: row.action,
      target: row.target,
      target_id: row.targetId ?? null,
      details: (row.details ?? {}) as Json,
    })
  return !error
}
