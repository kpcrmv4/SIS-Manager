# LOOP.md — SIS Manager build runbook

> อ่านไฟล์นี้ **ครั้งเดียวต่อ context** — ตอนเริ่ม session, ตอน resume, และหลัง compaction ·
> `.loop/state.json` อ่านทุก iteration · อ่านแล้ว**ต้อง**ตัดสินใจตามนี้ก่อนทำอะไร
> ไฟล์นี้ควบคุม **การลงมือตามแผนที่อนุมัติแล้ว** เท่านั้น — อนุมัติที่ `docs/design/demo.html` +
> `docs/design/DESIGN.md` + แผนใน `CLAUDE.md` §10 เมื่อ 2026-09-23 · ไม่มีแผน = หยุด กลับไป `kp-design-brainstorm`

`$KIT` = `C:/Users/Administrator/.claude/plugins/cache/kp-marketplace/kp-supabase-nextjs/0.31.1`
(Git Bash: `/c/Users/Administrator/.claude/plugins/cache/kp-marketplace/kp-supabase-nextjs/0.31.1`) —
ถ้า path นี้ไม่มี (cloud session / เวอร์ชันใหม่) ให้หา `kp-autonomous-loop/SKILL.md` ใต้ `~/.claude/plugins` แล้วใช้โฟลเดอร์แม่ของ `skills/`

---

## 0 · Environment (ปักหมุด — ห้ามเดา)

| อะไร | ค่า |
|---|---|
| Supabase MCP server | ตั้งด้วย `/setup-supabase-mcp` (PAT, project-scoped) · project_ref = `SUPABASE_PROJECT_REF` ใน `.env.local` |
| ตรวจก่อนใช้ | `get_project_url` ต้องตรงกับ `NEXT_PUBLIC_SUPABASE_URL` ใน `.env.local` — ไม่ตรง = หยุด |
| git remote / branch | `origin` (github.com/kpcrmv4/SIS-Manager) / `main` · `upstream` = Davis (อ่านอย่างเดียว ห้าม push) |
| dev port | `3000` |
| ห้ามแตะ | `.env*` (ยกเว้น P0-01 เพิ่มคีย์ generated ที่ยังไม่มี — ห้ามทับค่าเดิม) · `public/logo.png` · `docs/design/demo.html` · remote `upstream` |
| hook | `guard-shell-writes.mjs` ลงทะเบียนใน `.claude/settings.json` (PreToolUse Bash) ใน P0-01 |

**โหมดทำงาน**

| คันโยก | ค่าที่เลือก |
|---|---|
| โหมด | **รุม** — worker แยก worktree ในเฟส P2 และ P3 · P0 P1 P4 P5 orchestrator ทำเอง |
| max workers | **3** · collapse กลับเป็นปกติเมื่อ 2 worker ต้องแตะไฟล์เดียวกัน หรือ `verify-write-set.mjs --all` เจอ overlap หรือ worker blocked ติดกัน 2 ครั้ง |
| Phase 0 contract ก่อน fan-out | migration + types + RPC signature + route skeleton + message keys + tokens + deps — เจ้าของ: orchestrator (= P1-05 ต้อง done ก่อนเริ่ม P2) |
| โหมดตรวจสอบ | **เร็ว** (§3) · ขนาด batch **8** (§6) |

**Write set ต่อ worker (P2/P3)** — ห้ามแตะนอกนี้; ของร่วม (migration, `globals.css`, `components/ui`, `proxy.ts`, `lib/supabase`, `package.json`, message catalog keys ใหม่) → ขอ orchestrator

| worker | write set |
|---|---|
| P2-A | `src/app/(staff)/{deposits,tonight,scan}/**` · `src/components/deposit/**` · `src/lib/deposit/**` (ยกเว้น signatures) · `tests/e2e/P2-A*.spec.ts` |
| P2-B | `src/app/(staff)/{bookings,settings}/**` · `src/components/booking/**` · `src/lib/booking/**` · `tests/e2e/P2-B*.spec.ts` |
| P2-C | `src/app/liff/**` · `src/app/api/customer/**` · `src/components/liff/**` · `tests/e2e/P2-C*.spec.ts` |
| P3-A | `src/lib/line/**` · `src/app/api/line/**` · `src/app/api/cron/line-dispatch/**` |
| P3-B | `src/lib/print/**` · `src/app/api/print-server/**` · `print-server/**` |

หน้า scan ใช้ร่วม A (QR ใบฝาก) กับ B (QR บัตรจอง): orchestrator สร้าง `src/app/(staff)/scan/page.tsx` + ตัว dispatch ใน P1-05, A และ B เติมแค่ `src/components/{deposit,booking}/scan-result-*.tsx` ของตัวเอง

**โมเดลต่อบทบาท**

| บทบาท | โมเดล / effort | เหตุผล |
|---|---|---|
| orchestrator / planner | `claude-opus-5-5` / high | ถือภาพรวม เขียน contract, migration, RLS, auth |
| worker งาน judgement (RLS, migration, auth, state machine) | `claude-opus-5-5` / high | ungated — ในโปรเจกต์นี้ orchestrator ทำเองทั้งหมด |
| worker งานหน้าจอ P2/P3 (gated) | `claude-sonnet-5` / medium | tsc/build/spec จับให้ |
| reviewer มิติ RLS/auth/security | `claude-opus-5-5` / high | ungated judgement |
| reviewer มิติ correctness · convention/UI-kit · performance | `claude-sonnet-5` / low | verifier scripts คุม |
| Explore / read-only fan-out | `claude-sonnet-5` / low | อ่านอย่างเดียว |

**อนุญาตล่วงหน้า** (ไม่เขียน = ไม่อนุญาต):
- push ไป `origin/main` : **ใช่** (หลัง quick gate เขียว)
- deploy : **ไม่** — เจ้าของ deploy เอง
- apply migration ตรงโปรเจกต์ Supabase ใหม่ของ SIS Manager : **ใช่** (ยังไม่มีข้อมูลจริง) · โปรเจกต์อื่นทุกโปรเจกต์ : **ไม่**

**ค่าที่ผู้ใช้ต้องให้เอง — loop หาเองไม่ได้ และห้ามอ่านค่า** (`cut -d= -f1 .env.local` · ห้าม `cat`):

| กลุ่ม | คีย์ / สิ่งที่ต้องมี | สถานะ (2026-09-23) |
|---|---|---|
| `.env.local` Supabase | `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` · `SUPABASE_SECRET_KEY` | ว่าง |
| `.env.local` MCP (PAT) | `SUPABASE_PROJECT_REF` · `SUPABASE_ACCESS_TOKEN` | ว่าง |
| `.env.local` generated | `CRON_SECRET` · `CUSTOMER_TOKEN_SECRET` · `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` · `SEED_OWNER_PASSWORD` · `SEED_BAR_PASSWORD` · `SEED_STAFF_PASSWORD` *(P0-01 สร้าง ห้ามทับของเดิม)* | สร้างใน P0-01 |
| `.env.local` ฟีเจอร์ | `ENABLE_DEMO_LOGIN=true` (dev) · `APP_BASE_URL` (ว่างได้จน deploy — outbox cron เป็น no-op) | สร้างใน P0-01 |
| LINE ทดสอบ (ไม่บังคับ) | ใส่ผ่านหน้า ตั้งค่า → LINE ของสาขา (ไม่ใช่ env) | ไม่มี → แถวส่ง LINE จริงเป็น `manual_verify` |
| git | `origin/main` push ได้ | มีแล้ว |
| MCP | `get_project_url` ตรงกับ `NEXT_PUBLIC_SUPABASE_URL` | รอ PAT |

ถ้ามีแถวไหน **ว่าง** → ยังไม่เริ่ม · แจ้งชื่อคีย์ที่ขาดให้ผู้ใช้กรอกในไฟล์เอง (ไม่ใช่วางในแชท)

---

## 1 · Resume — ลำดับที่ทำทุกครั้งที่กลับมา

1. อ่าน `.loop/state.json`
2. **ยืนยันด้วย git ไม่ใช่ความจำ** — `git log --oneline | head -20` · `git status --short` · state ขัดกับ git → เชื่อ git
3. `git fetch origin` แล้ว `git rev-list --left-right --count HEAD...@{u}` · behind > 0 → **หยุด แจ้งผู้ใช้** (branch · กี่ commit · `git log -1 --format=%s @{u}`) ห้าม pull เอง · บันทึก `blocked_reason` แล้วจบ run
4. ตรวจของค้าง: Chrome MCP `list_pages` · พอร์ต
   `node -e "fetch('http://127.0.0.1:3000',{signal:AbortSignal.timeout(2000)}).then(r=>console.log('busy',r.status)).catch(()=>console.log('free'))"`
   → อะไรมีอยู่ก่อน = ไม่ใช่ของเรา (`.loop/owned.json`)
5. เริ่มที่งานแรกที่ยังไม่ `done` — **ทำต่อโดยไม่หยุดถาม**

---

## 2 · write sprint แล้วค่อย verify sprint

### 2a · write iteration — ทำซ้ำจนถึงเงื่อนไขปิด batch (§6)

```
1) เลือกงานแรกที่ยังไม่เสร็จ และ dependency ครบแล้ว → mark doing
   — หนึ่ง task = หนึ่งงานใน CLAUDE.md §10
   — task ติดป้ายเสี่ยง (auth / RLS / การเปลี่ยนสถานะฝาก-เบิก-จำหน่าย-จอง) → ไม่เข้า batch: ทำแล้ว full gate ทันที
   — task ถัดไปต้องพึ่งของที่ written แต่ยังไม่ verify → ปิด batch ก่อน (2b)
   — P2/P3: spawn worker ตาม write set §0 (Agent, isolation: worktree, model ตามตาราง) · brief 8 ข้อตาม kp-work-routing
2) ทำงานให้จบทั้ง task · ห้ามรีวิวงานตัวเอง — สิ่งที่ไม่แน่ใจไปช่อง unsure ของ ledger
3) quick gate (§3) · แดง → แก้ ≤ 3 รอบ · ยังแดง → blocked แล้วไปงานอื่น
4) เขียว → mark written · เขียน .loop/state.json + ต่อท้าย .loop/changes.jsonl + LESSONS.md (ถ้ามี)
   · commit เดียวรวมงาน + state + ledger: "<type>(<scope>): <desc> [<id>]" · push origin main
   · `node $KIT/skills/kp-autonomous-loop/progress.mjs` (derive ครั้งเดียว — ห้าม --watch)
5) เช็คเงื่อนไขปิด batch (§6) → ยังไม่ถึง → write iteration ถัดไป · ถึงแล้ว → 2b
```

### 2b · verify iteration — ครั้งเดียวต่อ batch

```
1) batch gate (§3) ครั้งเดียวทั้ง batch
2) reviewer แยกมิติ อ่านอย่างเดียว ขนานกัน — input = .loop/changes.jsonl + git diff <base>...HEAD · อ่าน unsure ก่อน diff
3) verify findings แบบ adversarial — มิติไหนเสร็จก่อนเข้า verify ทันที
4) แก้ findings ที่ยืนยันแล้ว — หนึ่ง commit ต่อกลุ่ม · รันซ้ำเฉพาะ check ที่ fix แตะ
5) เขียน spec จาก should_assert + แถว matrix → ติ๊กแถวได้เฉพาะตอนนี้ (§4)
6) ทุก task ใน batch → done · state + LESSONS.md · commit · push
7) จบเฟส → full gate (§3)
8) เช็ค stop conditions (§6) → ไม่เข้า → กลับ 2a
```

`.loop/changes.jsonl` — บรรทัดละ task ใน commit เดียวกับงาน:
`{"task":"P2-A1","rows":["P2A-DEP-01"],"commit":"<sha>","files":[…],"did":"…","should_assert":[…],"unsure":[…],"risk":"none|auth|rls|state","tsc":"green"}`

---

## 3 · Gate — โหมด **เร็ว**

ป้ายเสี่ยง (full gate ทันที ไม่ว่าโหมดไหน) = **auth / session / login** · **RLS หรือการมองเห็นตาม role/สาขา** · **การเปลี่ยนสถานะฝาก/เบิก/จำหน่ายออก/จอง**

### quick — จบทุก task
```
npm run typecheck
node $KIT/skills/kp-autonomous-loop/verify-lessons.mjs docs/LESSONS.md
```

### batch — ปิด batch (8 task) ครั้งเดียว
```
npm run build
npm run verify        # verify-route-guards · verify-red-tested scripts · verify-portability
node $KIT/skills/kp-work-routing/verify-write-set.mjs --worker <ID>      # เฉพาะงานของ worker
```
+ red-test เฉพาะ check ที่เกิดใหม่ใน batch · review 4 มิติ (correctness · RLS/auth/security · convention/UI-kit · performance) แล้ว verify findings ·
`node $KIT/skills/kp-autonomous-loop/lessons-report.mjs --json` (dedupe LESSONS ตาม tag)
*(โหมดเร็ว: ไม่รัน Playwright ใน batch — ย้ายไปจบเฟส ยกเว้นงานติดป้ายเสี่ยง)*

### full — จบเฟส **และ** ทุก task ติดป้ายเสี่ยง
```
npm run typecheck && npm run build && npm run verify
npx playwright test --reporter=json > results.json     # spec เฟสนี้และเฟสก่อนหน้า
node $KIT/skills/kp-e2e-playwright-real-db/verify-run-json.mjs results.json --expect-min <n>
```
+ `get_advisors(security)` ไม่มี ERROR ใหม่ (ถ้าแตะ DB) · RLS cross-branch/role spec (ถ้าแตะตาราง — leak = critical) ·
Chrome MCP sweep ทุกหน้าที่เฟสแตะ (มือถือ 390px + คอม 1280px, light + dark) · acceptance matrix ของเฟส (§4)

นอกรอบ: แตะของที่พังเฉพาะในเบราว์เซอร์ (cookie/proxy/redirect, realtime, PWA/SW, PDF, LIFF, scanner) → smoke สั้น ๆ ทันที
**exit code 0 ไม่ใช่หลักฐาน · HTTP 200 ก็ไม่ใช่** — ตรวจเนื้อหาจริง

---

## 4 · Acceptance matrix

- `docs/test-plan/<phase>.md` ตาม `kp-acceptance-test-matrix` **ก่อนโค้ดของเฟส** · row id เป็น prefix ของชื่อ test
- ติ๊กได้เฉพาะแถวที่มีคำสั่งซึ่งแดงได้จริง
- แถวที่ต้องใช้คน: ส่ง LINE จริง · LIFF ในแอป LINE จริง · พิมพ์จริงผ่าน print-server · สแกนด้วยกล้องมือถือ · web push บนมือถือจริง → `manual_verify: true` mark ได้แค่ code-green
- run ยังไม่จบตราบใดที่ยังมีแถวรอคน — ส่งรายการคืนตอนจบ (§9)

---

## 5 · ของที่เปิด = ของที่ต้องเก็บ

```
ก่อนเริ่ม : list_pages → จด id ที่มีอยู่ = ไม่ใช่ของเรา · port 3000 ไม่ว่างและไม่ใช่ของเรา → ใช้ 3001 ห้ามฆ่า
ระหว่าง   : ใช้ page เดิมซ้ำ · เปิดใหม่ → จด id ใน .loop/owned.json ทันที
จบรอบ     : close_page เฉพาะของเรา · หยุด dev server เฉพาะ PID ที่เราสตาร์ต
```
เพดาน: page เปิดเกิน 5 หรือ dev server ตัวที่สอง → หยุดแล้วรายงาน
Worktree ของ worker: root อยู่ใน `.gitignore` · node_modules แบบ hardlink ไม่ใช่ symlink และไม่ `npm install` ซ้ำ · ลบ worktree หลัง merge

---

## 6 · ขอบเขตและเงื่อนไขหยุด

| ขอบเขต | ค่า |
|---|---|
| แก้ต่องาน | 3 รอบ → blocked |
| **ขนาด batch** | **8** task → ปิด batch · `run.batch.size = 8` |
| ปิด batch ก่อนกำหนดเมื่อ | task ถัดไปพึ่งของที่ยัง written · จบเฟส · เจอป้ายเสี่ยง · unsure สะสม ≥ 5 · iteration budget เหลือ ≤ 1 |
| ขนาดงาน | 1 task = 1 งานใน CLAUDE.md §10 |
| ไฟล์ต่อ task | 25 → เขียนไว้ในสรุป ไม่ใช่ blocked · blocked เฉพาะงานที่แตะ migration / auth / tokens |
| iteration ต่อ run | 40 |
| blocked ติดกัน | 2 → หยุดทั้ง run |
| สืบหาสาเหตุ | วัดครบ 1 รอบแล้วทำซ้ำไม่ได้ → หยุด รายงานตัวเลข + คำถาม |
| จบเฟส | **ไปต่อทันที** (§7) |
| **สรุปรายงาน** | **ทำยาวจนเสร็จค่อยสรุป** — สรุปเดียวตอนจบ + run report |

**หยุดถามเฉพาะ 4 กรณี:** งานที่ย้อนกลับไม่ได้/ทำลายข้อมูล · ความปลอดภัย (คีย์ ความลับ สิทธิ์) · ผลกระทบนอกเครื่องที่ไม่ได้อนุญาตใน §0 (deploy) · แผนพังจนทุกทางเป็นการเดา
นอกนั้นตัดสินเองแล้วบันทึกใน `docs/RULINGS.md`: `Ruling: … — เพราะ: … — ถ้าผิด: …`
เรื่องของเจ้าของ (ข้อความการตลาด ข้อกำหนดการฝาก เงื่อนไขจองที่ไม่ได้คุย) → ค่าชั่วคราวที่สมเหตุสมผล ระบุว่าชั่วคราว ทำต่อ รวบรวมแจ้งตอนจบ

---

## 7 · สามสวิตช์

| | หยุดท้ายเฟส | วิ่งยาว |
|---|---|---|
| branch | `loop/<phase>` | **commit ลง main** ✔ |
| migration | dev branch เท่านั้น | **apply ตรงโปรเจกต์ใหม่ได้** ✔ |

**โปรเจกต์นี้เลือก: วิ่งยาว** เพราะเป็น greenfield ยังไม่มีข้อมูลลูกค้าจริงและยังไม่มีใครใช้ระบบ ·
worker P2/P3 ทำบน branch ของ worktree แล้ว orchestrator merge เข้า main หลัง verify-write-set ผ่าน ·
**พอมีข้อมูลจริงเมื่อไหร่ ให้สลับเป็นหยุดท้ายเฟส**

---

## 8 · ห้ามเด็ดขาด

- destructive DB: `DROP` / `TRUNCATE` / `DELETE` ไม่มี `WHERE` นอก reset script ที่ commit แล้ว · reset บนโปรเจกต์อื่น
- `push --force` · `reset --hard` บน commit ที่ push แล้ว · `rm -rf` · push ไป `upstream`
- แตะ `.env*` / secrets / path ในรายการห้ามแตะ · **`cat` ไฟล์ env หรือ settings**
- ย้าย/ลบ `print-server/` ทั้งโฟลเดอร์ (P3-B ปรับเท่านั้น)
- ไม่มั่นใจว่าปลอดภัย = ไม่ปลอดภัย → หยุด

---

## 9 · บทเรียน — จดตอนเจอ ไม่ใช่ตอนจบ

`docs/LESSONS.md` (รูปแบบในหัวไฟล์) · ก่อนเพิ่ม grep tag ก่อน — มีแล้ว → `- เกิดซ้ำ:` · การตัดสินใจ → `docs/RULINGS.md`

**ตอนจบ build — ข้อความเดียว สองครึ่ง**
1. สิ่งที่ต้องให้คนเดินเอง — จาก
   `node $KIT/skills/kp-work-routing/run-report.mjs --project . --playwright results.json` →
   "`<n>/<total> proven · <m> awaiting a person`" + รายการ row id / ทำอะไร / หน้าไหน · แถวที่ไม่เคยมีใครตรวจพูดถึงก่อน
2. บทเรียน — `node $KIT/skills/kp-autonomous-loop/lessons-report.mjs` แล้ววางผล 🔴/🟢/⚪
+ รายการค่าชั่วคราวที่เจ้าของต้องตัดสิน + ขั้นตอน deploy (Vercel env ที่ต้องคัดลอก: `CRON_SECRET`, `CUSTOMER_TOKEN_SECRET`, `VAPID_*`, Supabase keys, `APP_BASE_URL`)

---

## 10 · คำถามก่อนเริ่ม loop (ตอบแล้ว 2026-09-23)

1. **ขอบเขต** — P0 ถึง P5 ทั้งหมด · จบ = matrix ทุกเฟส reconcile แล้ว, full E2E เขียว, advisors ไม่มี ERROR, เหลือแต่แถว manual
2. **ใบอนุญาต** — push `origin/main` ได้ · deploy ไม่ได้ · apply migration ลงโปรเจกต์ SIS Manager ได้
3. **สามสวิตช์** — วิ่งยาว · commit ลง main · migration ตรง
4. **งบ** — 40 iteration ต่อ run · แก้ 3 รอบ · 1 task = งานใน CLAUDE.md §10
4b. **โหมดตรวจสอบ** — เร็ว (คำสั่งใน §3) · งานติดป้ายเสี่ยงได้ full gate เสมอ
4c. **batch** — 8 task
5. **ห้ามแตะ** — ตาม §0 + §8
6. **ข้อมูลจริง** — ไม่มี · ไม่มีใครเทสอยู่
7. **ค้างจากรอบก่อน** — ไม่มี (run แรก) · เครื่องเท่ากับ remote
8. **ตัดสินใจแทนได้แค่ไหน** — ทุกอย่างนอก 4 กรณีใน §6 · ข้อความข้อกำหนดการฝาก (terms) ใช้ของ Davis แปลเป็น 4 ภาษาเป็นค่าชั่วคราว
8b. **ใครเดินแถว manual** — เจ้าของ (kpcrmv4) หลังจบ run: LINE จริง, LIFF ในแอป LINE, print-server, กล้องสแกน, push บนมือถือ
9. **สรุปเมื่อไหร่** — ทำยาวจนเสร็จค่อยสรุปครั้งเดียว พร้อม run report
10. **ค่าที่ต้องให้ (§0)** — ยังว่าง: Supabase 3 คีย์ + PAT 2 คีย์ → เริ่มไม่ได้จนกว่าจะครบ
11. **ความคืบหน้า** — ผู้ใช้รัน `--watch` เอง · loop derive ครั้งเดียวต่อ iteration

---

## 11 · คำสั่งเริ่ม loop (ก๊อปเมื่อ §0 ครบเท่านั้น)

```
/loop อ่าน LOOP.md ก่อน แล้ว resume ตาม §1 · ทำ iteration ถัดไปตาม §2 · หยุดเฉพาะเมื่อเข้าเงื่อนไข §6 · สรุปตาม §10 ข้อ 9
```

---

## 12 · ความคืบหน้า (ไม่เปลือง token)

```
node $KIT/skills/kp-autonomous-loop/progress.mjs --watch     # เทอร์มินัลข้าง ๆ ใน VS Code
node $KIT/skills/kp-autonomous-loop/progress.mjs --init      # (ถ้าอยากได้หน้าเว็บ) docs/progress/index.html
```
แหล่งข้อมูลเดียวคือ `.loop/state.json` + git · agent ห้ามรัน `--watch` เอง และห้ามแตะ `docs/progress/index.html`
