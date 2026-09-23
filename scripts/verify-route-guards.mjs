#!/usr/bin/env node
/**
 * verify-route-guards.mjs — a `loading.tsx` above a page that calls
 * `notFound()` or `redirect()` turns the 404 / 307 into a 200.
 *
 * This is the single most-repeated lesson across three real ledgers — eight
 * times, in three projects, after the rule had been in nextjs-gotchas for a
 * month. A sentence in a skill that loads when the symptom is already visible
 * does not prevent the cause; a check that runs in the quick gate does.
 *
 * Mechanism (Next.js App Router): `loading.tsx` wraps its segment AND every
 * child segment in a Suspense boundary. A page inside that boundary that calls
 * `notFound()` streams the shell first, so the response status is already 200
 * when the not-found boundary renders; `redirect()` likewise loses its 307.
 * The fix is structural: the page that guards lives in its own route group
 * with its own `loading.tsx`, or the guard moves up into `layout.tsx`, which
 * renders before the boundary.
 *
 *   node verify-route-guards.mjs [appDir=app|src/app] [--json]
 *   node verify-route-guards.mjs --self-test
 *
 * Exit 0 = no guarded page under a loading boundary · 1 = at least one.
 * A page is "guarded" when its source calls notFound( or redirect( (from
 * next/navigation) at the top level of the page — a call inside a Server
 * Action or event handler does not change the page's status and is ignored
 * when it appears inside a function whose name starts with `action`/`handle`.
 */
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = /^page\.(tsx|jsx|ts|js)$/;
const LOADING = /^loading\.(tsx|jsx|ts|js)$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p, out); }
    else out.push(p);
  }
  return out;
}

function guardCalls(src) {
  // strip comments and strings crudely enough for this purpose
  const s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/.*(?=\n)/g, '$1');
  const calls = [];
  const re = /\b(notFound|redirect|permanentRedirect)\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    // ignore calls inside `async function action…` / `handle…` bodies (best effort: nearest preceding function name)
    const before = s.slice(0, m.index);
    const fn = [...before.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g)].pop();
    const name = fn ? (fn[1] || fn[2] || '') : '';
    if (/^(action|handle|on[A-Z])/.test(name)) continue;
    calls.push(m[1]);
  }
  return [...new Set(calls)];
}

export function check(appDir) {
  const root = resolve(appDir);
  if (!existsSync(root)) return { appDir, error: `no ${appDir}`, findings: [] };
  const files = walk(root);
  const loadingDirs = files.filter((f) => LOADING.test(f.split(/[\\/]/).pop())).map((f) => dirname(f));
  const findings = [];
  for (const f of files) {
    if (!PAGE.test(f.split(/[\\/]/).pop())) continue;
    const calls = guardCalls(readFileSync(f, 'utf8'));
    if (!calls.length) continue;
    const dir = dirname(f);
    const above = loadingDirs.filter((ld) => dir === ld || dir.startsWith(ld + '/') || dir.startsWith(ld + '\\'));
    if (above.length) findings.push({ page: relative(process.cwd(), f), calls, loading: above.map((d) => relative(process.cwd(), join(d, 'loading.tsx'))) });
  }
  return { appDir, findings, pages: files.filter((f) => PAGE.test(f.split(/[\\/]/).pop())).length, loadings: loadingDirs.length };
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'kp-rg-'));
  const w = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  let failed = 0;
  const t = (name, ok, d = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + d}`); if (!ok) failed++; };
  try {
    w('app/(app)/loading.tsx', 'export default function L(){return null}');
    w('app/(app)/sites/[id]/page.tsx', "import { notFound } from 'next/navigation'; export default async function P(){ const s = null; if(!s) notFound(); return null }");
    w('app/(app)/ok/page.tsx', "export default function P(){ return null }");
    w('app/(list)/loading.tsx', 'export default function L(){return null}');
    w('app/(list)/page.tsx', "export default function P(){ return null }");
    w('app/admin/page.tsx', "import { redirect } from 'next/navigation'; export default async function P(){ redirect('/login') }");
    w('app/form/page.tsx', "import { redirect } from 'next/navigation'; async function actionSave(){ 'use server'; redirect('/x') } export default function P(){ return null }");
    w('app/form/loading.tsx', 'export default function L(){return null}');
    const r = check(join(dir, 'app'));
    const pages = r.findings.map((f) => f.page);
    t('page calling notFound() under a parent loading.tsx is reported', pages.some((p) => p.includes('sites')), JSON.stringify(r));
    t('page with no guard is not reported', !pages.some((p) => p.includes('/ok/')));
    t('page with redirect() and no loading anywhere above is not reported', !pages.some((p) => p.includes('admin')));
    t('redirect() inside a server action does not count', !pages.some((p) => p.includes('form')), JSON.stringify(r.findings));
    t('the loading file that causes it is named', r.findings[0] && r.findings[0].loading[0].includes('(app)/loading.tsx'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(failed ? `\n${failed} self-test case(s) failed` : '\nall self-test cases passed');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) selfTest();
  const appDir = args.find((a) => !a.startsWith('--')) || (existsSync('app') ? 'app' : 'src/app');
  const r = check(appDir);
  if (r.error) { console.error(r.error); process.exit(1); }
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.findings.length ? 1 : 0); }
  for (const f of r.findings) console.log(`❌ ${f.page} calls ${f.calls.join('/')} under ${f.loading.join(', ')} — the status will be 200; move the page into its own route group with its own loading.tsx, or hoist the guard into layout.tsx (nextjs-gotchas §3)`);
  console.log(r.findings.length ? `\n${r.findings.length} guarded page(s) under a loading boundary (${r.pages} pages, ${r.loadings} loading files)` : `✅ ${r.pages} page(s), ${r.loadings} loading file(s): no guarded page sits under a loading boundary`);
  process.exit(r.findings.length ? 1 : 0);
}
