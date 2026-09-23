#!/usr/bin/env node
// Copies the values pg_cron needs from .env.local into Supabase Vault (this project only):
//   app_base_url ← APP_BASE_URL   (empty until deploy → the LINE dispatch job is a no-op)
//   cron_secret  ← CRON_SECRET
// Prints names and whether each is set — never the values. Re-run after changing either.
import { loadEnv, mgmt } from './lib/env.mjs'

const env = loadEnv()
const wanted = { app_base_url: env.APP_BASE_URL ?? '', cron_secret: env.CRON_SECRET ?? '' }
if (!wanted.cron_secret) {
  console.error('sync-vault: CRON_SECRET is missing in .env.local')
  process.exit(1)
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
for (const [name, value] of Object.entries(wanted)) {
  const query = `
    do $$
    declare sid uuid;
    begin
      select id into sid from vault.secrets where name = ${lit(name)};
      if sid is null then perform vault.create_secret(${lit(value)}, ${lit(name)});
      else perform vault.update_secret(sid, ${lit(value)}); end if;
    end $$;`
  await mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) })
  console.log(`sync-vault: ${name} ${value ? 'set' : 'empty (no-op until deploy)'}`)
}
