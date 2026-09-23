#!/usr/bin/env node
// Closes public sign-up on this project: staff accounts are created by the owner
// (service role), customers never get an auth user. Idempotent; prints only the
// settings it manages, never the rest of the auth config.
import { mgmt } from './lib/env.mjs'

// password_hibp_enabled (leaked-password check) needs the Pro plan — RULINGS R-010
const WANT = { disable_signup: true, external_anonymous_users_enabled: false, password_min_length: 8 }

const before = await mgmt('/config/auth')
const diff = Object.fromEntries(Object.entries(WANT).filter(([k, v]) => before[k] !== v))
if (Object.keys(diff).length) await mgmt('/config/auth', { method: 'PATCH', body: JSON.stringify(diff) })
const after = await mgmt('/config/auth')
for (const k of Object.keys(WANT)) console.log(`${k}: ${before[k]} → ${after[k]}`)
const bad = Object.entries(WANT).filter(([k, v]) => after[k] !== v)
if (bad.length) { console.error('auth-harden: not applied:', bad.map(([k]) => k).join(', ')); process.exit(1) }
