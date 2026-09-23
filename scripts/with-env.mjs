#!/usr/bin/env node
// Runs a command with the variables of an env file added to its environment, without
// copying the file anywhere. Worker worktrees have no .env.local (it is gitignored); they
// point SIS_ENV_FILE at the main checkout's file instead.
//   SIS_ENV_FILE=/path/to/.env.local node scripts/with-env.mjs npx next dev -p 3207
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const file = process.env.SIS_ENV_FILE
const extra = {}
if (file) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) extra[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error('usage: node scripts/with-env.mjs <command> [args…]')
  process.exit(1)
}
const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...extra }, shell: process.platform === 'win32' })
child.on('exit', (code) => process.exit(code ?? 0))
