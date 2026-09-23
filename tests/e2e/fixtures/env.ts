import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Playwright does not read .env.local. Load it the same way the scripts do:
 * the repo file wins over machine-wide variables.
 */
export function loadEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...process.env }
  let text = ''
  try {
    text = readFileSync(join(__dirname, '..', '..', '..', '.env.local'), 'utf8')
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
export const BASE_URL = `http://127.0.0.1:${PORT}`
export const AUTH_DIR = join(__dirname, '..', '.auth')
