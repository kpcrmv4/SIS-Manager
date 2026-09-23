#!/usr/bin/env node
/**
 * verify-red-tested.mjs — a checker that was never seen going red is not a
 * checker yet.
 *
 * "The checker cannot fail" was the largest rule family in three real
 * ledgers: 49 lessons. A grep that matched a comment, a detector whose number
 * could not move, a self-test that threw before asserting, a summariser that
 * read the wrong field and reported 0 with confidence. The rule — red-test
 * every new check once, at birth, by breaking the thing it guards — was in
 * kp-acceptance-test-matrix at line 712 of 908. This script makes it a gate:
 * every checker script in the project must carry the proof.
 *
 * A checker is any of: scripts/verify-*.mjs · scripts/checks/*.mjs ·
 * scripts/**\/*check*.mjs. (A bare "calls process.exit(1)" heuristic was
 * tried and flagged reports and boards — a heuristic that cries wolf gets
 * ignored, so the name is the contract: a script that decides is named
 * verify-* or lives in checks/.) It is "red-tested" when its source contains either
 *     --self-test            (it can red-test itself against fixtures)
 * or  // red-tested: <YYYY-MM-DD>, broke <what>   (a human broke the subject once)
 * The marker is a claim, and claims get audited — but a claim with a date
 * and a subject is auditable; silence is not.
 *
 *   node verify-red-tested.mjs [scriptsDir=scripts] [--json]
 *   node verify-red-tested.mjs --self-test
 */
import { readdirSync, readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = /\/\/\s*red-tested:\s*\d{4}-\d{2}-\d{2},\s*broke\s+\S/;
const SELF = /--self-test/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else out.push(p);
  }
  return out;
}

export function isChecker(path, src) {
  const base = path.split(/[\\/]/).pop();
  if (/^verify-.*\.(mjs|ts|js)$/.test(base)) return true;
  if (/check/i.test(base) && /\.(mjs|ts|js)$/.test(base)) return true;
  if (/\/checks\//.test(path.replace(/\\/g, '/'))) return true;
  return false;
}

export function check(scriptsDir) {
  const root = resolve(scriptsDir);
  if (!existsSync(root)) return { scriptsDir, checkers: [], missing: [] };
  const checkers = [];
  for (const f of walk(root)) {
    if (!/\.(mjs|ts|js)$/.test(f) || /\.test\.|\.spec\./.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    if (!isChecker(f, src)) continue;
    checkers.push({ file: relative(process.cwd(), f), selfTest: SELF.test(src), marker: MARKER.test(src) });
  }
  const missing = checkers.filter((c) => !c.selfTest && !c.marker);
  return { scriptsDir, checkers, missing };
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'kp-rt-'));
  const w = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  let failed = 0;
  const t = (name, ok, d = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + d}`); if (!ok) failed++; };
  try {
    w('scripts/verify-a.mjs', 'if (bad) process.exit(1)');
    w('scripts/verify-b.mjs', "// red-tested: 2026-09-16, broke the grant on orders\nif (bad) process.exit(1)");
    w('scripts/verify-c.mjs', "if (process.argv.includes('--self-test')) selfTest();");
    w('scripts/checks/d.mjs', 'console.log(1)');
    w('scripts/seed.mjs', 'if (x) process.exit(1)');
    w('scripts/verify-e.mjs', '// red-tested: someday, broke stuff\nprocess.exit(1)');
    const r = check(join(dir, 'scripts'));
    const miss = r.missing.map((m) => m.file.split(/[\\/]/).pop());
    t('verify-* without proof is missing', miss.includes('verify-a.mjs'), JSON.stringify(miss));
    t('a dated marker counts', !miss.includes('verify-b.mjs'));
    t('--self-test counts', !miss.includes('verify-c.mjs'));
    t('scripts/checks/* is a checker', miss.includes('d.mjs'));
    t('a plain script is not a checker', !r.checkers.some((c) => c.file.endsWith('seed.mjs')));
    t('a script not named verify-*/check* is not a checker even if it exits 1', !r.checkers.some((c) => c.file.endsWith('seed.mjs')));
    t('an undated marker does not count', miss.includes('verify-e.mjs'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(failed ? `\n${failed} self-test case(s) failed` : '\nall self-test cases passed');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) selfTest();
  const r = check(args.find((a) => !a.startsWith('--')) || 'scripts');
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.missing.length ? 1 : 0); }
  for (const m of r.missing) console.log(`❌ ${m.file} — no proof it can go red: add "--self-test" or "// red-tested: <date>, broke <what>" after breaking its subject once`);
  console.log(r.missing.length ? `\n${r.missing.length} of ${r.checkers.length} checker(s) never red-tested` : `✅ ${r.checkers.length} checker(s), every one carries proof it can fail`);
  process.exit(r.missing.length ? 1 : 0);
}
