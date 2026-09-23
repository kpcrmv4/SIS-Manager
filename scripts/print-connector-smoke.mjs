#!/usr/bin/env node
/**
 * P3-B2-06 smoke: drives the ported print-server/lib/supabase-connector.js — the same
 * module print-server.js uses — against the real DB with a generated print account's
 * credentials, and completes one pending job through it. No Puppeteer needed:
 * supabase-connector.js only talks to Supabase (auth + REST), which is why this can run
 * as a plain script instead of the full print server.
 *
 * Called from tests/e2e/P3-B2.spec.ts (P3-B2-06) as a child process — credentials travel
 * only through env vars, never printed. stdout carries exactly one line starting with
 * "RESULT:" followed by JSON; connector.js's own progress lines (console.log) go to the
 * same stream before it, so the caller greps for that prefix.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, STORE_ID, PRINT_ACCOUNT_EMAIL,
 *      PRINT_ACCOUNT_PASSWORD, JOB_ID
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SupabaseConnector = require('../print-server/lib/supabase-connector.js')

function need(name) {
  const v = process.env[name]
  if (!v) throw new Error(`print-connector-smoke: missing ${name}`)
  return v
}

async function main() {
  const config = {
    SUPABASE_URL: need('SUPABASE_URL'),
    SUPABASE_ANON_KEY: need('SUPABASE_ANON_KEY'),
    STORE_ID: need('STORE_ID'),
    PRINT_ACCOUNT_EMAIL: need('PRINT_ACCOUNT_EMAIL'),
    PRINT_ACCOUNT_PASSWORD: need('PRINT_ACCOUNT_PASSWORD'),
  }
  const jobId = need('JOB_ID')

  const connector = new SupabaseConnector(config)
  await connector.connect()

  const pending = await connector.fetchPendingJobs()
  const pickedUp = pending.some((j) => j.id === jobId)

  await connector.updateJobStatus(jobId, 'completed')
  await connector.sendHeartbeat({ status: 'ready' })

  console.log(`RESULT:${JSON.stringify({ ok: true, jobId, pickedUp })}`)
  process.exit(0)
}

main().catch((err) => {
  console.log(`RESULT:${JSON.stringify({ ok: false, error: err.message })}`)
  process.exit(1)
})
