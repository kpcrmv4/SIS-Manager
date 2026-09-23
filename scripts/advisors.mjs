#!/usr/bin/env node
// Compact advisor summary for THIS project (Management API, repo PAT).
//   node scripts/advisors.mjs [security|performance]   exit 1 when any ERROR-level lint exists
import { mgmt } from './lib/env.mjs'

const type = process.argv[2] ?? 'security'
const res = await mgmt(`/advisors/${type}`)
const lints = res.lints ?? []
let errors = 0
for (const l of lints) {
  const n = l.findings?.length ?? l.count ?? 1
  if (l.level === 'ERROR') errors += n
  const names = (l.findings ?? []).map((f) => f.metadata?.name).filter(Boolean)
  console.log(`${l.level.padEnd(5)} ${l.name} ×${n}${names.length ? ` — ${[...new Set(names)].slice(0, 12).join(', ')}` : ''}`)
}
console.log(`advisors(${type}): ${lints.length} lint kinds · ${errors} ERROR finding(s)`)
process.exit(errors ? 1 : 0)
