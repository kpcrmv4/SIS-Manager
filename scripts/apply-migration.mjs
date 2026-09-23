#!/usr/bin/env node
// Applies one supabase/migrations/*.sql file to THIS repo's project through the
// Management API migrations endpoint (the one the Supabase MCP apply_migration
// uses), so the migration history stays identical. The project ref is checked
// against NEXT_PUBLIC_SUPABASE_URL before anything is sent (scripts/lib/env.mjs).
//   node scripts/apply-migration.mjs supabase/migrations/20260923150000_deposits.sql
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { mgmt, projectRef } from './lib/env.mjs'

const file = process.argv[2]
if (!file || !file.endsWith('.sql')) {
  console.error('usage: node scripts/apply-migration.mjs <supabase/migrations/…sql>')
  process.exit(1)
}
const query = readFileSync(file, 'utf8')
const name = basename(file, '.sql').replace(/^\d+_/, '')
console.log(`apply-migration: ${basename(file)} (${query.length} bytes) → project ${projectRef()}`)
try {
  await mgmt('/database/migrations', { method: 'POST', body: JSON.stringify({ query, name }) })
} catch (e) {
  console.error(String(e.message).slice(0, 1200))
  process.exit(1)
}
const rows = await mgmt('/database/query', {
  method: 'POST',
  body: JSON.stringify({ query: `select version, name from supabase_migrations.schema_migrations order by version desc limit 3` }),
})
console.log('apply-migration: ok · latest history:', JSON.stringify(rows))
