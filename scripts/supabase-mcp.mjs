#!/usr/bin/env node
// Launches the Supabase MCP server bound to THIS repo's project.
// Reads .env.local itself so the binding never depends on the shell that started the client,
// and the repo's values win over any machine-wide SUPABASE_* variables.
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = '@supabase/mcp-server-supabase@0.13.0'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(path) {
  const out = {}
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

const env = loadEnvFile(join(root, '.env.local'))
const ref = env.SUPABASE_PROJECT_REF
const token = env.SUPABASE_ACCESS_TOKEN
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ''

if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  process.stderr.write('supabase-mcp: SUPABASE_PROJECT_REF missing or malformed in .env.local\n')
  process.exit(1)
}
if (!token) {
  process.stderr.write('supabase-mcp: SUPABASE_ACCESS_TOKEN missing in .env.local\n')
  process.exit(1)
}
if (url !== `https://${ref}.supabase.co`) {
  process.stderr.write('supabase-mcp: NEXT_PUBLIC_SUPABASE_URL does not match SUPABASE_PROJECT_REF\n')
  process.exit(1)
}

// Read-only unless the owner opted this project into writes (LOOP.md §0 grants migrations).
const args = ['-y', SERVER, `--project-ref=${ref}`]
if (env.SUPABASE_MCP_WRITE !== 'true') args.push('--read-only')

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
  shell: process.platform === 'win32',
})
child.on('exit', (code) => process.exit(code ?? 0))
