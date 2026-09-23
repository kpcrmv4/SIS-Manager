#!/usr/bin/env node
/**
 * verify-portability — the six ways a repo authored on one OS breaks on another.
 *
 * The round trip this exists for: author on Windows → push → continue in a
 * cloud session (Linux) → deploy to Vercel (Linux). Every check below is
 * invisible on the machine that created the problem and fatal on the machine
 * that receives it, which is why none of them is caught by `tsc` or by a local
 * `next build`:
 *
 *   P-01  An import whose CASE differs from the file resolves fine on Windows
 *         and macOS and fails on Linux with "Module not found" for a file that
 *         is plainly sitting right there. This is the one that reaches
 *         production, because the first machine to complain is Vercel.
 *   P-02  Linux happily creates `docs/report: final.md` or `lib/aux.ts`. The
 *         Windows clone cannot check them out — and reports them as DELETED,
 *         so the next `git commit -a` deletes them for everyone.
 *   P-03  Two paths differing only in case cannot coexist in a Windows
 *         checkout at all.
 *   P-04  A CRLF blob in the index turns into `$'\r': command not found`, a
 *         shebang that cannot be executed, and patch scripts that never find
 *         their marker.
 *   P-05  A committed symlink needs Developer Mode on Windows; without it the
 *         clone gets a text file containing a path.
 *   P-06  package.json scripts run under cmd.exe on Windows: `rm -rf .next`
 *         and `FOO=bar next dev` are not commands there.
 *
 * Truth comes from the git INDEX, never from the filesystem — `existsSync`
 * lies on a case-insensitive volume, and the worktree's line endings are
 * whatever `core.autocrlf` made them. So this file gives the same verdict on
 * all four machines, which is the whole point of it.
 *
 * Usage:
 *   node verify-portability.mjs [--root .] [--json]
 *   node verify-portability.mjs --self-test    # red-tests every rule
 *
 * Copy into scripts/ and run it in the full gate and/or a pre-push hook. No
 * dependencies; Node 18+.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';

/* ---- git ---------------------------------------------------------------- */

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, '');

/** Tracked paths, their index EOL, and their mode — one source of truth. */
function index(root) {
  const files = [];
  const eol = new Map();
  for (const line of git(root, ['ls-files', '--eol']).split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const attrs = line.slice(0, tab);
    const path = line.slice(tab + 1);
    eol.set(path, (attrs.match(/i\/(\S+)/) || [, 'none'])[1]);
    files.push(path);
  }
  const mode = new Map();
  for (const line of git(root, ['ls-files', '-s']).split('\n')) {
    if (!line) continue;
    const m = line.match(/^(\d{6}) \S+ \d+\t(.*)$/);
    if (m) mode.set(m[2], m[1]);
  }
  return { files, eol, mode };
}

/* ---- P-01 · import case ------------------------------------------------- */

const CODE = /\.(m?[jt]sx?|cjs)$/;
const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];
const INDEX_EXT = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs'];
const SPECIFIER =
  /(?:^|[^\w$])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w$])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^\w$])import\s*['"]([^'"]+)['"]/g;

/** Alias prefixes from tsconfig `paths`, falling back to the Next.js default. */
function aliases(root) {
  const out = [];
  for (const f of ['tsconfig.json', 'jsconfig.json']) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    let cfg;
    try {
      cfg = JSON.parse(readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1'));
    } catch { continue; }
    const co = cfg.compilerOptions || {};
    const base = (co.baseUrl || '.').replace(/^\.\//, '').replace(/\/$/, '');
    for (const [from, to] of Object.entries(co.paths || {})) {
      if (!from.endsWith('/*') || !Array.isArray(to)) continue;
      for (const t of to) {
        if (!t.endsWith('/*')) continue;
        const target = posix.normalize(posix.join(base === '.' ? '' : base, t.slice(0, -2))).replace(/^\.?\//, '');
        out.push({ prefix: from.slice(0, -1), target: target === '.' ? '' : target.replace(/\/$/, '') });
      }
    }
  }
  if (!out.some((a) => a.prefix === '@/')) out.push({ prefix: '@/', target: existsSync(join(root, 'src')) ? 'src' : '' });
  return out;
}

function importCase(root, files) {
  const tracked = new Set(files);
  const lower = new Map();
  for (const f of files) {
    const k = f.toLowerCase();
    if (!lower.has(k)) lower.set(k, f);
  }
  const alias = aliases(root);
  const bad = [];

  for (const file of files.filter((f) => CODE.test(f))) {
    let src;
    try { src = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(SPECIFIER)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;

      let base = null;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        base = posix.normalize(posix.join(posix.dirname(file), spec));
        if (base.startsWith('..')) continue; // outside the repo — not ours to judge
      } else {
        const a = alias.find((x) => spec.startsWith(x.prefix));
        if (!a) continue; // a package, not a path
        base = posix.normalize(posix.join(a.target, spec.slice(a.prefix.length)));
      }

      const candidates = [...EXT.map((e) => base + e), ...INDEX_EXT.map((e) => base + e)];
      if (candidates.some((c) => tracked.has(c))) continue; // exact hit — correct
      const hit = candidates.map((c) => lower.get(c.toLowerCase())).find(Boolean);
      if (hit) bad.push({ file, spec, actual: hit }); // resolves only case-insensitively
      // no hit at all: generated file, gitignored, or a package — not a case bug
    }
  }
  return bad;
}

/* ---- P-02 · Windows-illegal paths --------------------------------------- */

const RESERVED = new Set(
  ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)],
);

function illegalPaths(files) {
  const bad = [];
  for (const f of files) {
    for (const seg of f.split('/')) {
      // eslint-disable-next-line no-control-regex
      const ch = seg.match(/[<>:"|?*\\\u0000-\u001f]/);
      if (ch) { bad.push(`${f} — illegal character ${JSON.stringify(ch[0])}`); break; }
      if (/[. ]$/.test(seg)) { bad.push(`${f} — segment ends in a dot or space`); break; }
      if (RESERVED.has(seg.split('.')[0].toUpperCase())) { bad.push(`${f} — reserved DOS device name`); break; }
    }
  }
  return bad;
}

/* ---- P-03 · case collisions --------------------------------------------- */

function caseCollisions(files) {
  const seen = new Map();
  const bad = [];
  for (const f of files) {
    const k = f.toLowerCase();
    if (seen.has(k)) bad.push(`${seen.get(k)} ⟷ ${f}`);
    else seen.set(k, f);
  }
  return bad;
}

/* ---- P-04 · line endings ------------------------------------------------ */

function crlfBlobs(eol) {
  const bad = [];
  for (const [f, e] of eol) if (e === 'crlf' || e === 'mixed') bad.push(`${f} (i/${e})`);
  return bad;
}

function eolPinned(root) {
  const p = join(root, '.gitattributes');
  if (!existsSync(p)) return null;
  const txt = readFileSync(p, 'utf8');
  return /^\s*\*\s+text=auto/m.test(txt) ? (/eol=lf/.test(txt) ? 'ok' : 'no-eol') : 'no-star';
}

/* ---- P-05 · symlinks ---------------------------------------------------- */

const symlinks = (mode) => [...mode].filter(([, m]) => m === '120000').map(([f]) => f);

/* ---- P-06 · npm scripts ------------------------------------------------- */

const POSIX_ONLY = /(^|[;&|]\s*|\s&&\s|\s\|\|\s)(rm|cp|mv|touch|chmod|ln|export|cat|which)\s/;
const ENV_PREFIX = /(^|[;&|]\s*|&&\s*|\|\|\s*)[A-Za-z_][A-Za-z0-9_]*=\S/;

function npmScripts(root, files) {
  const bad = [];
  for (const f of files.filter((x) => x === 'package.json' || x.endsWith('/package.json'))) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(root, f), 'utf8')); } catch { continue; }
    for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
      if (typeof cmd !== 'string') continue;
      if (POSIX_ONLY.test(cmd)) bad.push(`${f} · ${name}: POSIX-only command — ${cmd}`);
      else if (ENV_PREFIX.test(cmd)) bad.push(`${f} · ${name}: inline env assignment (use .env or cross-env) — ${cmd}`);
    }
  }
  return bad;
}

/* ---- audit -------------------------------------------------------------- */

export function audit(root) {
  const { files, eol, mode } = index(root);
  const pin = eolPinned(root);
  return {
    files: files.length,
    checks: [
      { id: 'P-01', label: 'imports match their file on a case-sensitive disk',
        bad: importCase(root, files).map((b) => `${b.file}: "${b.spec}" → ${b.actual}`) },
      { id: 'P-02', label: 'every tracked path can exist on Windows', bad: illegalPaths(files) },
      { id: 'P-03', label: 'no two paths differ only in case', bad: caseCollisions(files) },
      { id: 'P-04a', label: 'no CRLF committed to the index', bad: crlfBlobs(eol) },
      { id: 'P-04b', label: '.gitattributes pins the line endings',
        bad: pin === 'ok' ? [] : [pin === null ? 'no .gitattributes — every clone decides its own EOL'
          : pin === 'no-star' ? '.gitattributes has no `* text=auto` rule'
            : '.gitattributes has `* text=auto` but never says `eol=lf`'] },
      { id: 'P-05', label: 'no committed symlinks', bad: symlinks(mode) },
      { id: 'P-06', label: 'npm scripts run under cmd.exe too', bad: npmScripts(root, files) },
    ],
  };
}

/* ---- self-test ---------------------------------------------------------- */

function fixture(build) {
  const dir = mkdtempSync(join(tmpdir(), 'portability-'));
  const w = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  w('.gitattributes', '* text=auto eol=lf\n');
  w('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } }));
  w('package.json', JSON.stringify({ scripts: { build: 'next build', clean: 'node -e "fs.rmSync(\'.next\',{recursive:true,force:true})"' } }, null, 2));
  w('components/Button.tsx', 'export const Button = () => null;\n');
  w('app/page.tsx', "import { Button } from '@/components/Button';\nimport './styles.css';\nexport default () => Button;\n");
  w('app/styles.css', 'body{}\n');
  build?.({ dir, w });
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'core.autocrlf=false', 'add', '-A']);
  return dir;
}

function selfTest() {
  const cases = [
    { name: 'a clean repo passes every check', expect: [], build: null },
    {
      name: 'P-01 an import whose case differs from the file', expect: ['P-01'],
      build: ({ w }) => w('app/page.tsx', "import { Button } from '@/components/button';\nexport default () => Button;\n"),
    },
    {
      name: 'P-01 …including a relative specifier', expect: ['P-01'],
      build: ({ w }) => w('app/page.tsx', "import { Button } from '../components/BUTTON';\nexport default () => Button;\n"),
    },
    { name: 'P-02 a DOS device name', expect: ['P-02'], build: ({ w }) => w('lib/aux.ts', 'export {};\n') },
    { name: 'P-02 an illegal character', expect: ['P-02'], build: ({ w }) => w('docs/report: final.md', '#\n') },
    { name: 'P-02 a segment ending in a space', expect: ['P-02'], build: ({ w }) => w('docs/draft /x.md', '#\n') },
    { name: 'P-03 two paths differing only in case', expect: ['P-03'], build: ({ w }) => w('components/button.tsx', 'export {};\n') },
    {
      name: 'P-04a a CRLF blob that `eol=lf` does not reach, because the file is marked -text',
      expect: ['P-04a'],
      build: ({ w }) => { w('.gitattributes', '* text=auto eol=lf\n*.sh -text\n'); w('scripts/x.sh', '#!/usr/bin/env bash\r\necho hi\r\n'); },
    },
    { name: 'P-04b no .gitattributes at all', expect: ['P-04b'], build: ({ dir }) => rmSync(join(dir, '.gitattributes')) },
    { name: 'P-04b .gitattributes that never says eol=lf', expect: ['P-04b'], build: ({ w }) => w('.gitattributes', '* text=auto\n') },
    { name: 'P-05 a committed symlink', expect: ['P-05'], build: ({ dir }) => symlinkSync('components/Button.tsx', join(dir, 'Button.link.tsx')) },
    {
      name: 'P-06 rm -rf in an npm script', expect: ['P-06'],
      build: ({ w }) => w('package.json', JSON.stringify({ scripts: { clean: 'rm -rf .next && next build' } })),
    },
    {
      name: 'P-06 an inline env assignment', expect: ['P-06'],
      build: ({ w }) => w('package.json', JSON.stringify({ scripts: { dev: 'DEBUG=1 next dev' } })),
    },
    {
      name: 'P-06 …but cross-env is fine', expect: [],
      build: ({ w }) => w('package.json', JSON.stringify({ scripts: { dev: 'cross-env DEBUG=1 next dev' } })),
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const dir = fixture(c.build);
    let red;
    try { red = [...new Set(audit(dir).checks.filter((x) => x.bad.length).map((x) => x.id))].sort(); }
    finally { rmSync(dir, { recursive: true, force: true }); }
    const want = [...new Set(c.expect)].sort();
    const ok = red.join(',') === want.join(',');
    if (!ok) failed += 1;
    console.log(`${ok ? '✅' : '❌'} ${c.name}${ok ? '' : ` — expected [${want}], got [${red}]`}`);
  }
  console.log(failed === 0 ? '\nevery rule goes red on its own fixture, and green on a clean one' : `\n${failed} SELF-TEST CASE(S) FAILED`);
  return failed;
}

/* ---- cli ---------------------------------------------------------------- */

const isMain = process.argv[1] && /verify-portability\.mjs$/.test(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() === 0 ? 0 : 1);

  const i = args.indexOf('--root');
  const root = i > -1 && args[i + 1] ? args[i + 1] : process.cwd();
  let report;
  try { report = audit(root); }
  catch (e) { console.error(`cannot read the git index at ${root} — run this from inside the repo (${e.message})`); process.exit(2); }

  if (args.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(report.checks.some((c) => c.bad.length) ? 1 : 0); }

  for (const c of report.checks) {
    console.log(`${c.bad.length === 0 ? '✅' : '❌'} ${c.id} ${c.label}${c.bad.length ? ` — ${c.bad.length}` : ''}`);
    for (const b of c.bad.slice(0, 20)) console.log(`     · ${b}`);
    if (c.bad.length > 20) console.log(`     · …and ${c.bad.length - 20} more`);
  }
  const failures = report.checks.filter((c) => c.bad.length).length;
  console.log(failures === 0 ? `\nPORTABLE — ${report.files} tracked files` : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
