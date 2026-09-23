#!/usr/bin/env node
// Runs a .sql file against THIS repo's project (Management API, ref checked) and prints
// the result rows. For red-testing (apply a mutant, run the spec, restore) and one-off
// maintenance — schema changes still go through supabase/migrations + apply-migration.mjs.
//   node scripts/run-sql.mjs <file.sql> [--replace FROM TO]
import { readFileSync } from 'node:fs'
import { mgmt } from './lib/env.mjs'

const [file, flag, from, to] = process.argv.slice(2)
let query = readFileSync(file, 'utf8')
if (flag === '--replace') {
  if (!query.includes(from)) {
    console.error(`run-sql: "${from}" not found in ${file}`)
    process.exit(1)
  }
  query = query.split(from).join(to)
}
try {
  const rows = await mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) })
  console.log(JSON.stringify(rows).slice(0, 2000))
} catch (e) {
  console.error(String(e.message).slice(0, 1200))
  process.exit(1)
}
