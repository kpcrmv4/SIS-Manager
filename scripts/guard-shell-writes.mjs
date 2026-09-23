#!/usr/bin/env node
/**
 * guard-shell-writes.mjs — a PreToolUse hook that refuses to write code through
 * the shell.
 *
 * Seventeen lessons across three real builds, one mechanism: source code sent
 * through `node -e "…"`, `sed -i`, `printf`, or a heredoc reaches the file with
 * `$(…)` substituted to nothing, backticks executed, `\d` collapsed to `d`, a
 * BOM turned into a character, or a Thai string mangled — and no error from
 * node, because node never saw the original. The rule "write code with the
 * Write/Edit tool" was in kp-cross-platform. It recurred anyway, because the
 * moment it applies is the moment a one-liner looks faster. So it is a hook:
 * Claude Code runs this before every Bash call; exit 2 blocks the call and the
 * message on stderr is shown to the agent.
 *
 * Register in the project's .claude/settings.json (committed, so a cloud
 * session gets it too):
 *   { "hooks": { "PreToolUse": [ { "matcher": "Bash",
 *       "hooks": [ { "type": "command",
 *                    "command": "node <kit>/skills/kp-cross-platform/guard-shell-writes.mjs" } ] } ] } }
 *
 * What it blocks (only when the command writes to a source-ish file):
 *   - `node -e` / `node --eval` whose code contains $( ` \ or non-ASCII text
 *   - a heredoc (<<EOF / <<'EOF' / <<-EOF) whose target is a .ts .tsx .js .mjs
 *     .cjs .sql .css .json .md file and whose body contains \ $( ` or non-ASCII
 *   - `sed -i` / `perl -pi` editing a source file
 *   - `printf`/`echo … > file.ts` with escapes or non-ASCII
 * What it allows: everything else, including `node --check file`, `node
 * script.mjs`, heredocs into scratch/tmp paths, and heredocs with plain ASCII
 * (a shell script, a plain-text fixture).
 *
 *   node guard-shell-writes.mjs --self-test
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = /\.(tsx?|m?[cj]s|sql|css|json|md|ya?ml|html|toml)\b/;
const RISKY = /(\$\(|`|\\[a-zA-Z0-9.\\$(){}[\]|]|[^\x00-\x7F])/; // substitution, backtick, backslash escape, non-ASCII
const SCRATCH = /(^|[\s/])(\/tmp\/|\$TMPDIR|scratch|\.scratch|tmp\/)/;

export function judge(command) {
  const c = String(command || '');
  const reasons = [];
  // node -e / --eval with risky content
  const ev = c.match(/\bnode\s+(?:-e|--eval|-p|--print)\s+(['"])([\s\S]*?)\1/);
  if (ev && RISKY.test(ev[2])) reasons.push('node -e with $( ` \\ or non-ASCII in the code — the shell rewrites it before node sees it');
  // heredoc into a source file
  const hd = c.match(/(?:cat|tee)\s*(?:>>?|-a)?\s*([^\s<]+)?\s*<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?\s*\n([\s\S]*?)\n\2\b/);
  if (hd) {
    const target = (c.match(/>\s*([^\s;&|]+)/) || [])[1] || hd[1] || '';
    if (SRC.test(target) && !SCRATCH.test(target) && RISKY.test(hd[3])) reasons.push(`heredoc into ${target} with \\ $( \` or non-ASCII in the body — Git Bash and sh collapse escapes even inside <<'EOF'`);
  }
  // sed -i / perl -pi on a source file
  const sed = c.match(/\b(sed\s+(?:-[a-zA-Z]*i[a-zA-Z]*|--in-place)[^|;&]*?|perl\s+-[a-zA-Z]*i[a-zA-Z]*[^|;&]*?)\s(\S+\.(?:tsx?|m?[cj]s|sql|css))\b/);
  if (sed && !SCRATCH.test(sed[2])) reasons.push(`in-place edit of ${sed[2]} with ${sed[1].split(/\s/)[0]} — use the Edit tool; sed cannot see what it broke`);
  // printf / echo redirect into a source file
  const pe = c.match(/\b(printf|echo)\s+(['"])([\s\S]*?)\2[^|;&]*>\s*(\S+)/);
  if (pe && SRC.test(pe[4]) && !SCRATCH.test(pe[4]) && RISKY.test(pe[3])) reasons.push(`${pe[1]} into ${pe[4]} with escapes or non-ASCII — use the Write tool`);
  return reasons;
}

function selfTest() {
  let failed = 0;
  const t = (name, cmd, want) => {
    const r = judge(cmd);
    const ok = want ? r.length > 0 : r.length === 0;
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(r)}`}`);
    if (!ok) failed++;
  };
  t('node -e with $() is blocked', `node -e "document.title=$('#x').text" > a.js`, true);
  t('node -e with backslash regex is blocked', `node -e 'const r=/^\\d{1,9}$/; console.log(r)'`, true);
  t('node -e plain ascii is allowed', `node -e "console.log(1+1)"`, false);
  t('node --check is allowed', `node --check scripts/x.mjs`, false);
  t('node script is allowed', `node scripts/verify-x.mjs --self-test`, false);
  t('heredoc into .tsx with backtick is blocked', "cat > app/page.tsx <<'EOF'\nconst s = `x ${y}`;\nEOF", true);
  t('heredoc into .ts with Thai is blocked', "cat > lib/copy.ts <<'EOF'\nexport const t = 'สวัสดี'\nEOF", true);
  t('heredoc into .sql with backslash is blocked', "cat > supabase/migrations/1.sql <<EOF\nselect '\\d';\nEOF", true);
  t('heredoc plain ascii into .sh is allowed', "cat > run.sh <<'EOF'\necho hi\nEOF", false);
  t('heredoc into /tmp is allowed', "cat > /tmp/x.ts <<'EOF'\nconst a = `b`;\nEOF", false);
  t('heredoc into scratchpad is allowed', "cat > /home/u/scratchpad/x.ts <<'EOF'\nconst a = `b`;\nEOF", false);
  t('python heredoc with Thai (not a source target) is allowed', "python3 - <<'EOF'\nprint('สวัสดี')\nEOF", false);
  t('sed -i on a .ts is blocked', `sed -i 's/a/b/' lib/x.ts`, true);
  t('sed -i on a .md is allowed (prose, not code)', `sed -i 's/a/b/' docs/x.md`, false);
  t('sed without -i is allowed', `sed -n 1,20p lib/x.ts`, false);
  t('printf with escape into .ts is blocked', `printf 'const r = /\\d/;\\n' > lib/x.ts`, true);
  t('echo ascii into .txt is allowed', `echo "ok" > docs/x.txt`, false);
  t('git and grep are allowed', `git diff --name-only main...HEAD | grep -c ts`, false);
  console.log(failed ? `\n${failed} self-test case(s) failed` : '\nall self-test cases passed');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let cmd = '';
    try { const j = JSON.parse(input); cmd = j.tool_input?.command ?? j.command ?? ''; } catch { cmd = input; }
    const reasons = judge(cmd);
    if (!reasons.length) process.exit(0);
    process.stderr.write(`BLOCKED by guard-shell-writes (kp-cross-platform): ${reasons.join(' · ')}. Write the file with the Write or Edit tool, then run node --check on it.\n`);
    process.exit(2);
  });
}
