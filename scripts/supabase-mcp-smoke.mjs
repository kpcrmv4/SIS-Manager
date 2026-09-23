#!/usr/bin/env node
// Proves the MCP launcher is bound to the project in .env.local:
// speaks JSON-RPC to scripts/supabase-mcp.mjs, calls get_project_url, compares the ref.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envText = readFileSync(join(root, '.env.local'), 'utf8')
const expected = envText.match(/^SUPABASE_PROJECT_REF=(.+)$/m)?.[1]?.trim()
if (!expected) {
  console.error('smoke: SUPABASE_PROJECT_REF missing in .env.local')
  process.exit(1)
}

const child = spawn(process.execPath, [join(root, 'scripts', 'supabase-mcp.mjs')], {
  stdio: ['pipe', 'pipe', 'inherit'],
})
let buf = ''
const pending = new Map()
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      pending.get(msg.id)?.(msg)
    } catch {
      /* non-JSON log line */
    }
  }
})
const send = (id, method, params) =>
  new Promise((resolve) => {
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })

const timer = setTimeout(() => {
  console.error('smoke: timed out waiting for the MCP server')
  child.kill()
  process.exit(1)
}, 90_000)

await send(1, 'initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'sis-mcp-smoke', version: '1' },
})
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
const res = await send(2, 'tools/call', { name: 'get_project_url', arguments: {} })
clearTimeout(timer)
child.kill()

const text = res.result?.content?.[0]?.text ?? JSON.stringify(res.error ?? res)
const url = text.match(/https:\/\/[^"\s]+/)?.[0] ?? ''
const ok = !url.includes('${') && url === `https://${expected}.supabase.co`
console.log(ok ? `smoke: OK — MCP bound to ${url}` : `smoke: FAIL — got ${text}`)
process.exit(ok ? 0 : 1)
