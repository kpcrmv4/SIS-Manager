import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'

export type LiquorItem = { id: string; name: string; category: string }

/** Active items visible to this branch — branch-specific rows plus the branch-null (all-branch) ones. */
export async function listLiquorItems(branchId: string): Promise<LiquorItem[]> {
  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('liquor_items')
    .select('id, name, category')
    .or(`branch_id.eq.${branchId},branch_id.is.null`)
    .eq('active', true)
    .order('sort')
    .order('name')
    .range(0, 499)
  if (error || !data) return []
  return data
}
