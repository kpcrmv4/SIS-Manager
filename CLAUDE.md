# SIS Manager — CLAUDE.md

Liquor-deposit (ฝากเหล้า) + table-booking (จองโต๊ะ) system for **SIS Music Bar**, multiple branches.
Staff app (Thai/English) + customer LINE LIFF (th/en/zh/ko). Rebuilt from scratch; the deposit
**business logic** is ported from Davis-Inventory (read it at commit `758a39f` or remote `upstream`,
e.g. `git show 758a39f:supabase/migrations/20260910054500_...sql`). Stock, central warehouse, chat, HR,
POS from Davis are **out of scope** — never port them.

Approved design: `docs/design/demo.html` + `docs/design/DESIGN.md` (decisions, roles, business rules,
token values, token mapping). Read DESIGN.md before any UI or business-rule task.

## 0 · Skill precedence
Kit (`kp-supabase-nextjs`) wins on auth/session, RLS/grants/migrations and Next 16 mechanics
(`proxy.ts`, `getClaims()`, never mocking the Supabase client); `vercel-react-best-practices` and
`supabase-postgres-best-practices` win on query plans, indexing, pooling, render and bundle performance.

## 1 · Structure decisions (from the design jam — do not change without the owner)
- **Tenancy:** one organization, many branches. `branch_id` on per-branch tables. **No `org_id`,
  no onboarding, no `is_sample`, no demo tenant.**
- **Permissions:** fixed roles `staff` / `bar` / `owner` (matrix in DESIGN.md). Owner sees every
  branch; others only branches in `user_branches`. **No invites, no per-user RBAC.** RLS on every table.
- **Login:** username-or-email + password; owner creates staff accounts (service role). **No PIN.**
  Username login maps to a synthetic email `<username>@staff.sis.local` server-side.
- **Customers:** LINE LIFF only, no Supabase Auth user. Customer API routes verify the LIFF access
  token (`/v2/profile` **and** the channel via `/oauth2/v2.1/verify` → `client_id` must match the branch)
  or a signed customer token (HMAC, `CUSTOMER_TOKEN_SECRET`, no fallback secret), then use the service role.

## 2 · Stack
Next.js 16 App Router + React 19 + TypeScript strict · `proxy.ts` (not middleware.ts) · Tailwind v4
CSS-first · latest `@supabase/ssr` + `@supabase/supabase-js` · `@tanstack/react-query` · `next-themes`
(class strategy) · `next-intl` · `lucide-react` · `sonner` · `@radix-ui/react-dialog` ·
`@react-pdf/renderer` · `exceljs` · `browser-image-compression` · `web-push` · `@line/liff` ·
`qrcode` (render) + `@zxing/browser` (scan) · Playwright. Vercel Hobby `sin1`; Supabase `ap-southeast-1`.

## 3 · Design system
**The page kit gives structure and behaviour; every colour value comes from the demo's tokens.**
`thai-admin-page-kit` components (`components/ui/*`) and its `tokens.css` are copied for token
*names* and component classes; every value in `:root` / `.dark` is replaced from DESIGN.md, and
kit-only tokens follow DESIGN.md "Token mapping". Run `verify-contrast.mjs` on `globals.css` after.
- Staff app = "Minimal" palette; dark sidebar (`--brand-sidebar`); primary buttons `--brand` + `--on-brand`.
- LIFF = "Night Bar" palette scoped under `.cx` (dark-first; cream when the customer picks light).
- Fonts: IBM Plex Sans Thai (all body) · Noto Serif Thai (LIFF headings) · `tabular-nums` for numbers.
- Shell: desktop sidebar with small category headings ↔ mobile bottom nav 5 slots:
  คืนนี้ (owner: ภาพรวม) · ฝากเหล้า · **[สแกน QR — raised dark center, icon only]** · จองโต๊ะ ·
  เพิ่มเติม (bottom sheet, never a centered dialog on phones).
- Landing: staff/bar → `/tonight`; owner → `/overview`. Mobile = cards, desktop = tables.
- Every visible string comes from the message catalogs (`messages/staff/{th,en}.json`,
  `messages/customer/{th,en,zh,ko}.json`), lifted from the demo. Drop every `data-demo-only` element.
- lucide icons, never emoji · sonner toasts, never `alert()` · radix dialogs for confirm.
- Every data view has four states: skeleton / error + retry / empty / success.

## 4 · Data model (Postgres, all tables RLS-enabled)
Enums: `user_role(staff,bar,owner)` · `deposit_status(requested,pending_confirm,in_store,pending_withdrawal,withdrawn,expired,disposed,cancelled)`
· `bottle_status(sealed,opened,consumed)` · `withdrawal_status(pending,completed,rejected,cancelled)` · `withdrawal_type(in_store,take_home)`
· `booking_status(pending,confirmed,arrived,no_show,cancelled,rejected)` · `booking_source(line,staff)`
· `outbox_status(queued,sending,sent,failed,skipped)` · `print_status(pending,printing,done,failed)` · `app_locale(th,en,zh,ko)`.

| table | key columns | RLS |
|---|---|---|
| `branches` | code (unique, in DEP codes), name, active, deposit_days (30), expiry_notice_days (7), withdrawal_blocked_days text[] ({Fri,Sat}), liff_id, line_channel_id, line_bot_user_id, staff_group_id, receipt_settings jsonb | read: members of the branch + owner · write: owner |
| `branch_line_secrets` | branch_id pk, channel_access_token, channel_secret | **no policy for authenticated** — service role only |
| `profiles` | id = auth.users, username unique, display_name, role, locale (th/en), active | read self + owner; role/active writable by owner only (column-guard trigger) |
| `user_branches` | user_id, branch_id | owner writes; users read own |
| `liquor_items` | branch_id nullable (null = all), name, category, active, sort | read branch members · write owner |
| `customers` | line_user_id unique, display_name, phone, locale | staff read via branch deposits/bookings; writes via service role |
| `deposits` | branch_id, code unique, customer_id, customer_name, customer_phone, table_label, item_id, item_name, category, quantity, remaining_qty, remaining_percent, status, is_vip, expires_at, collect_deadline_at, received_by, confirmed_by, disposed_at/by, dispose_reason, photo paths, terms_* , expiry_notice_sent_at, expired_notice_sent_at | read branch members · **no direct UPDATE/INSERT for authenticated** — RPCs only |
| `deposit_bottles` | deposit_id, bottle_no, remaining_percent, status | follows deposit · RPC writes |
| `withdrawals` | deposit_id, branch_id, bottle_id, qty, type, status, by_customer, requested_by, processed_by, table_label, photo, notes | read branch members · RPC writes |
| `deposit_events` | deposit_id, actor_id, action, payload, created_at | append-only (read branch members) |
| `table_zones` / `tables` | branch_id, name/label, sort, customer_bookable, shape, seats_min/max, active | read members · write owner |
| `booking_settings` | branch_id pk, line_enabled, auto_confirm, advance_days 14, cutoff_time 18:00, slot_start 19:00, slot_end 23:00, slot_minutes 30, max_bookings_per_night, party_min, party_max, no_show_minutes 30, customer_cancel_hours 2, closed_weekdays int[] | read members · write owner |
| `booking_blackouts` | branch_id, night date, reason — unique(branch_id, night) | read members · write owner |
| `bookings` | branch_id, code `BK-MMDD-NNN` unique per branch, night, slot_time, party_size, zone_id, table_id, customer_id, name, phone, note, source, status, qr_token unique, confirmed_by, arrived_at, checked_in_by, cancelled_at, cancel_reason | read members · RPC writes |
| `line_outbox` | branch_id, target (user/group id), kind, locale, payload jsonb, status, attempts, sent_at, error, **dedupe_key unique** | service role only |
| `notifications` / `push_subscriptions` | in-app bell rows per user · web push endpoints | own rows |
| `print_jobs` / `print_stations` | branch_id, type (receipt/label), copies, payload, status · heartbeat | members read/insert own branch · print-server service account updates |

**State changes are RPCs** (SECURITY DEFINER, `set search_path = ''`, role + branch checked inside,
each writes `deposit_events` / enqueues `line_outbox` in the same transaction): `create_deposit`,
`staff_receive_request`, `confirm_deposit`, `reject_deposit` (→ `cancelled`, always), `request_withdrawal`,
`complete_withdrawals` (port Davis `complete_deposit_withdrawals`), `reject_withdrawal`, `extend_deposit`,
`set_vip`, `dispose_deposits` (bulk), `expire_due_deposits` (cron), `create_booking` (enforces every
booking_settings rule + blackouts + capacity), `confirm_booking`, `reject_booking`, `assign_table`,
`check_in_booking` (by code or qr_token), `cancel_booking`, `mark_no_shows` (cron),
`booking_availability(branch, from, to)`. Port from Davis: `auto_create_deposit_bottles`,
`private.deposit_collection_deadline` + trigger, the withdrawal-deadline guard, `enforce_deposit_expiry_vip_bar_only`
(re-scoped to roles `bar`/`owner`).

## 5 · Supabase connection & DB workflow
- **PAT per project** (`SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` in `.env.local`), MCP set up with
  `/setup-supabase-mcp`, read-only by default. **Before any migration:** `get_project_url` must equal
  `NEXT_PUBLIC_SUPABASE_URL`.
- Every DB change = a file in `supabase/migrations/` **and** applied via MCP → select it back →
  regenerate `src/types/database.ts` → `get_advisors(security)` has no new ERROR.
- Realtime = broadcast-from-database triggers + `realtime.messages` policies (per-branch topics).
- Scheduled work = **pg_cron** (UTC!): expiry notices daily 05:00 UTC (12:00 BKK) · expire past
  `collect_deadline_at` hourly · `mark_no_shows` every 5 min · outbox dispatch every minute via
  `pg_net` → `POST {APP_BASE_URL}/api/cron/line-dispatch` with `CRON_SECRET` (no-op while `APP_BASE_URL`
  is unset; server actions also dispatch inline with `after()`). Never plan around Vercel Hobby cron.

## 6 · Data-scale rules
Every list query `.order()` + `.range()` (PostgREST silently caps at 1,000 rows). KPI numbers via
`count: 'exact', head: true` or RPC aggregates. Exports chunked. Search terms quoted before `.or()`.

## 7 · Time
All dates pinned to `Asia/Bangkok`: `timeZone` on every `Intl` format, `at time zone 'Asia/Bangkok'`
for night/day buckets. Booking "night" = the business date (a 01:30 check-in belongs to the previous
night). Display years in พ.ศ. for Thai, ค.ศ. for other locales.

## 8 · Folder structure
```
src/app/(auth)/login · src/app/(staff)/{tonight,overview,deposits,deposits/[id],deposits/new,bookings,scan,reports,settings/{booking,tables,items,users,branch,line},me}
src/app/liff/[branch]/{page (my deposits),deposit,book,ticket/[code]}   ← customer, .cx theme
src/app/api/{customer/*,line/webhook,cron/*,print-server/*}
src/lib/{supabase/{browser,server,admin,proxy}.ts,auth,deposit,booking,line,print,i18n,date.ts,copy.ts,constants.ts}
src/components/{ui (page kit),shell,deposit,booking,liff}
messages/staff/{th,en}.json · messages/customer/{th,en,zh,ko}.json
supabase/migrations · print-server/ (ported) · tests/e2e · docs/{design,test-plan,LESSONS.md,RULINGS.md}
```

## 9 · Demo & reset (single-organization set)
Committed reset migration/script + demo seed covering every display state (each deposit status,
VIP, near-expiry, expired awaiting disposal, each booking status, a closed weekday and a blackout,
3 branches). One-tap demo login per role guarded by `ENABLE_DEMO_LOGIN`; seeded passwords come
from env (`SEED_*`), never hard-coded. Self-service password change asks for the current password.

## 10 · Build phases (task ids are what `.loop/state.json` tracks)
**P0 — scaffold + auth (orchestrator, alone)**
- P0-01 Remove the Davis app tree (keep `print-server/`, `public/` icons + logo, `docs/design/`); bootstrap Next 16 + TS + Tailwind v4; deps; `.gitattributes`; `.claude/settings.json` (plugin + `guard-shell-writes.mjs` hook); `.github/workflows/portability.yml`; `vercel.json` `{regions:["sin1"]}`; `next.config` `allowedDevOrigins`; npm scripts `typecheck`/`verify`; `.env.local` generated values (never overwrite)
- P0-02 `globals.css` from kit tokens + DESIGN.md values + mapping; copy page-kit components; verify-contrast green
- P0-03 i18n (next-intl): staff th/en, customer th/en/zh/ko catalogs from the demo strings
- P0-04 Four Supabase clients + `proxy.ts` gate excluding `/api/*` and `/liff/*`; login (username or email); cookies bound to the response
- P0-05 App shell: sidebar ↔ bottom nav + เพิ่มเติม sheet, theme toggle, role-aware landing, branch switcher
- P0-06 Playwright harness: config (`workers:1`), `global-setup` storageState per role
**P1 — schema + RLS + RPCs (orchestrator, alone; reviewer: RLS/security)**
- P1-01 Core: branches, secrets, profiles, user_branches, liquor_items, customers + RLS + column guards
- P1-02 Deposits: deposits, bottles, withdrawals, events + ported triggers/guards + all deposit RPCs
- P1-03 Bookings: zones, tables, settings, blackouts, bookings + booking RPCs + availability
- P1-04 Outbox, notifications, push_subscriptions, print_jobs/stations, storage buckets (private), realtime broadcast triggers, pg_cron jobs
- P1-05 Types generated; RPC TS signatures in `src/lib/*/actions.ts` with `throw new Error('TODO <task>')`; route skeletons; copy keys; RLS isolation spec (cross-branch, per role)
**P2 — screens (fan-out, workers A/B/C in separate worktrees)**
- P2-A1 Deposits list + tabs + search + detail · P2-A2 Receive/confirm/withdraw/extend/VIP/dispose flows · P2-A3 Tonight + scan (deposit QR part)
- P2-B1 Bookings plan + list + staff booking form · P2-B2 Check-in + scan (booking QR) · P2-B3 Owner settings: booking rules + calendar, tables/zones, liquor items, users/branches
- P2-C1 LIFF shell + auth + locale · P2-C2 My deposits + withdrawal request + deposit request · P2-C3 Booking form + ticket + cancel
**P3 — integrations (fan-out, workers A/B)**
- P3-A1 LINE messaging + flex templates ×4 locales · P3-A2 Outbox dispatch + staff group notifications · P3-A3 Webhook (signature required, DEP-code link flow)
- P3-B1 Print jobs + receipt/label with QR · P3-B2 print-server port (drop transfer/HQ) + setup route
**P4 — extras (orchestrator)**
- P4-01 Owner overview + reports + PDF (Thai) + Excel · P4-02 Realtime + in-app bell · P4-03 PWA + web push
**P5 — close**
- P5-01 Reset + demo seed + demo login · P5-02 Acceptance matrices reconciled, full E2E, advisors clean

## 11 · Conventions (hard rules)
- RLS on every table; role set server-side only; never trust client metadata.
- Destructure `error` from every Supabase call. Every endpoint has a reachable UI, with matching roles.
- Small files (< 800 lines), immutable updates, no `console.log` in prod code.
- Imports match file case exactly; npm scripts are cross-platform (no `rm -rf`/`cp`/`FOO=bar`);
  multi-line maintenance → `scripts/*.mjs`. Never edit Thai text through PowerShell pipes.
- Every phase ships `docs/test-plan/<phase>.md` (acceptance matrix) before its code; risk phases
  (auth, RLS, deposit/booking state writes) commit Playwright specs whose titles start with row ids.
- `tsc` + `next build` green before a commit. Conventional commits. **No attribution footer.**
- Traps go to `docs/LESSONS.md`, decisions to `docs/RULINGS.md` — **CLAUDE.md is frozen during a run.**
- Never `cat` env/settings files; key names only (`cut -d= -f1 .env.local`). Never commit secrets.
- Org names live in `src/lib/constants.ts` (`APP_NAME = 'SIS Manager'`, `SHOP_NAME = 'SIS Music Bar'`).
