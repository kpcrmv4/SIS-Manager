// Public values are inlined at build time; read them in one place so a missing
// key fails with its name instead of an opaque "fetch failed".
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

export function assertPublicEnv() {
  if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  if (!SUPABASE_PUBLISHABLE_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured')
}
