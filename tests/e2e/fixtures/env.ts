import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Playwright does not read .env.local. Load it the same way the scripts do:
 * the repo file wins over machine-wide variables.
 */
export function loadEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...process.env }
  let text = ''
  // a worker worktree has no .env.local; SIS_ENV_FILE points at the main checkout's (never copied)
  const file = process.env.SIS_ENV_FILE ?? join(__dirname, '..', '..', '..', '.env.local')
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return out
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

export const env = loadEnv()

export function required(name: string): string {
  const v = env[name]
  if (!v) throw new Error(`E2E: ${name} is not set (.env.local)`)
  return v
}

export const PORT = Number(env.E2E_PORT ?? 3000)

/**
 * Which fixture set this run owns. Parallel workers each take their own letter so their
 * runs never rotate each other's passwords, park each other's accounts or clear each
 * other's rows: branches Z<letter>A / Z<letter>B, users e2e<letter>.<role>.
 * Default 'T' is the orchestrator's set (branches ZTA/ZTB, users e2e.<role>).
 */
export const FIXTURE = (env.E2E_FIXTURE ?? 'T').toUpperCase()
if (!/^[A-Z]$/.test(FIXTURE)) throw new Error('E2E_FIXTURE must be one letter')
export const BASE_URL = `http://127.0.0.1:${PORT}`
export const AUTH_DIR = join(__dirname, '..', '.auth')
