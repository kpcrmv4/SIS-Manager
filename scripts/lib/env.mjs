// Source-aware env loader for scripts (Node does not read .env.local by itself).
// The repo's .env.local wins over machine-wide variables, so a stray global
// SUPABASE_* token can never point a script at another project.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function loadEnv() {
  const out = { ...process.env }
  let text = ''
  try {
    text = readFileSync(join(root, '.env.local'), 'utf8')
  } catch {
    return out
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

/** The project ref, checked against the public URL so no script can target another project. */
export function projectRef(env = loadEnv()) {
  const ref = env.SUPABASE_PROJECT_REF
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) throw new Error('SUPABASE_PROJECT_REF missing or malformed')
  if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL does not match SUPABASE_PROJECT_REF')
  }
  return ref
}

/** Management API call with the repo PAT. Never logs the token. */
export async function mgmt(path, init = {}) {
  const env = loadEnv()
  const ref = projectRef(env)
  if (!env.SUPABASE_ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN missing')
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Management API ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`)
  try { return JSON.parse(body) } catch { return body }
}
