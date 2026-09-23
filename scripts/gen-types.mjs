#!/usr/bin/env node
// Regenerates src/types/database.ts from the live project (Management API, repo PAT).
// Refuses to write a stub: the file must contain every table named on the command line
// (default: the tables that exist so far), so a silent empty generation fails loudly.
//   node scripts/gen-types.mjs [expectedTable ...]
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mgmt, root } from './lib/env.mjs'

const expected = process.argv.slice(2).length ? process.argv.slice(2) : ['branches', 'profiles']
const res = await mgmt('/types/typescript?included_schemas=public')
const types = typeof res === 'string' ? res : res.types
if (typeof types !== 'string' || !types.includes('export type Database')) {
  console.error('gen-types: response has no Database type')
  process.exit(1)
}
const missing = expected.filter((t) => !new RegExp(`\\n\\s{6}${t}: \\{`).test(types))
if (missing.length) {
  console.error(`gen-types: generated types lack ${missing.join(', ')} — not writing a stub`)
  process.exit(1)
}
const file = join(root, 'src', 'types', 'database.ts')
writeFileSync(file, types.endsWith('\n') ? types : types + '\n')
const tables = (types.match(/\n\s{6}[a-z_]+: \{\n\s{8}Row:/g) || []).length
const fns = (types.split('Functions: {')[1] || '').match(/\n\s{6}[a-z_]+: \{/g)?.length ?? 0
console.log(`gen-types: wrote src/types/database.ts · ${tables} tables · ${fns} functions`)
