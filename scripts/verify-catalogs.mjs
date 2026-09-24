#!/usr/bin/env node
/**
 * verify-catalogs.mjs — every locale of a catalog has exactly the same keys,
 * and every {placeholder} in the reference locale appears in each translation.
 *
 * A key present in th.json but missing in en.json renders the raw key
 * ("deposits.tabExpired") on the English screen and no build step notices.
 *
 *   node scripts/verify-catalogs.mjs            # messages/staff + messages/customer + messages/manual
 *   node scripts/verify-catalogs.mjs --self-test
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out[key] = v
  }
  return out
}

// top-level ICU arguments only: {name} or {count, plural, ...}
export function args(s) {
  if (typeof s !== 'string') return []
  const found = new Set()
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z0-9_]+)/.exec(s.slice(i))
        if (m) found.add(m[1])
      }
      depth++
    } else if (s[i] === '}') depth--
  }
  return [...found].sort()
}

export function compare(ref, refName, other, otherName) {
  const problems = []
  const a = flatten(ref)
  const b = flatten(other)
  for (const k of Object.keys(a)) {
    if (!(k in b)) { problems.push(`${otherName}: missing key ${k}`); continue }
    if (Array.isArray(a[k]) !== Array.isArray(b[k])) { problems.push(`${otherName}: ${k} type differs`); continue }
    if (Array.isArray(a[k]) && a[k].length !== b[k].length) problems.push(`${otherName}: ${k} has ${b[k].length} items, ${refName} has ${a[k].length}`)
    const need = args(a[k])
    const have = args(b[k])
    for (const p of need) if (!have.includes(p)) problems.push(`${otherName}: ${k} lacks {${p}}`)
    if (typeof b[k] === 'string' && b[k].trim() === '') problems.push(`${otherName}: ${k} is empty`)
  }
  for (const k of Object.keys(b)) if (!(k in a)) problems.push(`${otherName}: extra key ${k} (not in ${refName})`)
  return { problems, keys: Object.keys(a).length }
}

function check(dir, ref) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  const refObj = JSON.parse(readFileSync(join(dir, `${ref}.json`), 'utf8'))
  let problems = []
  let keys = 0
  for (const f of files) {
    if (f === `${ref}.json`) continue
    const r = compare(refObj, ref, JSON.parse(readFileSync(join(dir, f), 'utf8')), `${dir.split(/[\\/]/).slice(-2).join('/')}/${f}`)
    problems = problems.concat(r.problems)
    keys = r.keys
  }
  return { problems, keys, files: files.length }
}

function main() {
  let total = 0
  let scanned = 0
  // manual: the /manual text (R-037), kept out of the staff catalog — same key-for-key rule
  for (const sub of ['staff', 'customer', 'manual']) {
    const dir = join(root, 'messages', sub)
    if (!existsSync(dir)) { console.log(`FAIL: ${dir} missing`); return 1 }
    const { problems, keys, files } = check(dir, 'th')
    scanned += files
    console.log(`${problems.length ? '❌' : '✅'} messages/${sub}: ${files} locales · ${keys} keys · ${problems.length} problem(s)`)
    for (const p of problems.slice(0, 40)) console.log(`   ${p}`)
    total += problems.length
  }
  if (scanned < 6) { console.log(`FAIL: expected 6 catalogs, found ${scanned}`); return 1 }
  return total ? 1 : 0
}

function selfTest() {
  const ref = { a: { b: 'x {n}', c: ['1', '2'] }, d: '{count, plural, one {# x} other {# y}}' }
  const cases = [
    ['identical passes', compare(ref, 'ref', ref, 'o').problems.length === 0],
    ['missing key fails', compare(ref, 'ref', { a: { c: ['1', '2'] }, d: '{count}' }, 'o').problems.some((p) => p.includes('missing key a.b'))],
    ['missing placeholder fails', compare(ref, 'ref', { a: { b: 'x', c: ['1', '2'] }, d: '{count}' }, 'o').problems.some((p) => p.includes('lacks {n}'))],
    ['extra key fails', compare(ref, 'ref', { ...ref, z: 'q' }, 'o').problems.some((p) => p.includes('extra key z'))],
    ['array length fails', compare(ref, 'ref', { a: { b: 'x {n}', c: ['1'] }, d: '{count}' }, 'o').problems.length === 1],
    ['plural inner braces are not args', args('{count, plural, one {# day} other {# days}}').join() === 'count'],
  ]
  let failed = 0
  for (const [n, ok] of cases) { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} self-test: ${n}`) }
  return failed ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : main())
}
