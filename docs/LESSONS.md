# LESSONS — SIS Manager

> จดทันทีที่จับได้ ไม่ใช่ตอนจบ · นับเป็นบทเรียนเมื่อโปรเจ็คอื่นจะโดนอีก (พิมพ์ผิดไม่นับ) ·
> ห้ามมีข้อมูลบุคคลหรือ credential · **การตัดสินใจของโปรเจ็ค (ราคา งวด นโยบาย) ไม่ใช่บทเรียน → `docs/RULINGS.md`**
>
> ตรวจรูปแบบด้วย `node <kit>/skills/kp-autonomous-loop/verify-lessons.mjs` (อยู่ใน quick gate) —
> ไฟล์ที่สคริปต์อ่านไม่ได้คือไฟล์ที่ตอนจบ run ไม่มีใครรวมเข้า skill ได้
>
> **ก่อนเพิ่มข้อใหม่ ให้ grep `tag` เดิมก่อน** — ถ้ามีอยู่แล้ว เพิ่มบรรทัด `เกิดซ้ำ:` ใต้ข้อเดิม
> ไม่ใช่เขียนข้อใหม่ · จำนวน `เกิดซ้ำ` คือหลักฐานว่ากฎนี้ต้องกลายเป็นสคริปต์ ไม่ใช่ประโยค

<!-- รูปแบบ (ทุกข้อ ทุกช่อง ชื่อช่องตรงตัว บรรทัดละช่อง):

## L-001 · 2026-09-16 · kp-testing-cadence · checker-cannot-fail
- อาการ: ตัวตรวจ focus-contrast รายงาน 4,212 ปัญหาเท่าเดิมทั้งก่อนและหลังแก้
- สาเหตุ: probe อ่าน `--brand` จาก :root ไม่ใช่ `outline-color` ที่ fix ตั้งไว้
- หลักฐาน: docs/review/T5-04/focus-20260916T0010Z.txt
- กฎ: ตัวตรวจต้องพิมพ์ counter ของกลาง (sheets/rulesSeen) และตัวเลขต้องขยับเมื่อโค้ดที่มันเฝ้าเปลี่ยน
- status: new
- เกิดซ้ำ: T6-03a 2026-09-17
- supersedes: L-000

หัวข้อ = `## <id> · <วันที่ ค.ศ.> · <skill เจ้าของ> · <tag>`
  id       L-001, L-002 … ไม่ซ้ำ ไม่ย้อน · ไม่มีชื่อเรื่อง (อาการอยู่ในช่องของมัน)
  เจ้าของ  ต้องเป็น skill ที่มีจริง (รายชื่อ + alias ของ command ใน lessons-owners.json)
  tag      จาก lessons-tags.json — คำใหม่ต้องเพิ่มในไฟล์นั้นก่อน จึงจะใช้ได้
ช่อง
  อาการ     สิ่งที่คนเห็น ≤ 120 ตัวอักษร
  สาเหตุ    กลไกจริง ไม่ใช่ที่เดาครั้งแรก ≤ 200
  หลักฐาน   path ของไฟล์หลักฐาน หรือตัวเลข/สตริงจริง — ไม่ใช่ย่อหน้า ≤ 200
  กฎ        **หนึ่งประโยค หนึ่งกฎ** ≤ 200 · มีสองกฎ = สองบทเรียน
  status    new | merged:<skill>@<version> | superseded-by:L-nnn | project-only | expired
  เกิดซ้ำ   (ไม่บังคับ ซ้ำได้) <task id> <วันที่> — เพิ่มเมื่อเจออีกครั้ง แทนการเขียนข้อใหม่
  supersedes (ไม่บังคับ) L-nnn — ข้อเก่าต้องถูกเปลี่ยน status เป็น superseded-by
-->

---

## L-001 · 2026-09-23 · thai-admin-page-kit · contrast-resolve-var
- อาการ: verify-contrast ของ kit อ่าน globals.css ที่ map token ด้วย var()/color-mix() ไม่ได้ และบังคับ WHITE บน brand-solid
- สาเหตุ: dark theme ของเดโม่ใช้ brand ชมพูอ่อน + --on-brand สีเข้ม · hover แบบผสมดำ (DESIGN mapping) ทำให้ on-brand เหลือ 3.91:1
- หลักฐาน: scripts/verify-contrast.mjs STAFF DARK on-brand on brand-solid-active 3.91
- กฎ: ตัวตรวจ contrast ต้องคำนวณสีจริงของ token ที่ map ด้วย var()/color-mix() โดยใช้ --on-brand ของโปรเจกต์เป็นตัวอักษรบน brand-solid
- status: new

## L-002 · 2026-09-23 · kp-e2e-playwright-real-db · port-pid
- อาการ: global-setup ล็อกอินได้ 401 {"error":"unauthorized"} ซึ่ง route ของเราไม่มีวันตอบ
- สาเหตุ: อีกโปรเจกต์ (next start -p 3000) ยึดพอร์ตระหว่างสองรอบ และ webServer.reuseExistingServer:true ใช้แอปนั้นแทนโดยไม่เตือน
- หลักฐาน: Get-NetTCPConnection 3000 → PID 9816 C:\projects\huay … next start -p 3000
- กฎ: global-setup ต้องพิสูจน์ว่าเซิร์ฟเวอร์ที่ reuse เป็นแอปของเราจริง (เช่น หน้า /login มีชื่อแอป) ก่อนล็อกอิน
- status: new

## L-003 · 2026-09-23 · nextjs-supabase-ssr-auth · logout-replace
- อาการ: ออกจากระบบแล้วกด Back ยังเห็นหน้า /tonight ทั้งที่ cookie ถูกลบและ GET /tonight ตอบ 307
- สาเหตุ: เบราว์เซอร์คืนหน้าจาก HTTP cache/bfcache โดยไม่ส่ง request · Next dev ส่ง Cache-Control ไม่มี no-store และทับ header ที่ proxy ตั้ง
- หลักฐาน: tests/e2e/P0-auth.spec.ts P0-AUTH-03 แดงก่อนเพิ่ม src/components/shell/bfcache-guard.tsx
- กฎ: layout ที่ต้องล็อกอินต้อง reload เมื่อเอกสารถูกโหลดด้วย navigation type back_forward หรือ pageshow.persisted
- status: new

## L-004 · 2026-09-23 · kp-work-routing · tree-moved
- อาการ: ไฟล์ที่ orchestrator เพิ่งแก้กลับเป็นเวอร์ชันเก่าระหว่าง review แล้วกลับมาเองทีหลัง
- สาเหตุ: reviewer แบบ Explore (อ่านอย่างเดียว) รัน git stash เพื่อดู diff ของ commit ขณะ orchestrator แก้ไฟล์ขนานกัน แล้ว pop คืนตอนจบ
- หลักฐาน: git stash list → stash@{0}: On main: review-temp-stash ขณะ reviewer correctness ยังทำงาน
- กฎ: brief ของ reviewer ต้องห้าม git stash/checkout/reset ชัดเจน และ orchestrator ห้ามแก้ working tree ระหว่างที่ reviewer ยังรัน
- status: new

## L-005 · 2026-09-23 · kp-e2e-playwright-real-db · wait-for-success-element
- อาการ: P2-A2-03 ผ่านใน worktree แต่แดงหลัง merge — ค่าวันหมดอายุที่ fill แล้วถูกบันทึกเป็นค่าเริ่มต้น แม้ toHaveValue จะผ่าน
- สาเหตุ: Playwright fill input ก่อน React hydrate เสร็จ render แรกของ React เขียนค่า state เดิมทับ DOM
- หลักฐาน: results.json Expected 2026-12-22 Received 2026-10-23 · แก้ด้วย data-hydrated บน new-deposit-form
- กฎ: ฟอร์ม client ที่เทสต์พิมพ์ลงไปต้องมี data-hydrated และ spec ต้องรอให้เป็น true ก่อน fill/click ช่องแรก
- status: new

## L-006 · 2026-09-23 · kp-e2e-playwright-real-db · leftover-fixture
- อาการ: spec ของ worker C แดงด้วย blackout ที่ไม่มี spec ไหนของ C หรือ A สร้าง
- สาเหตุ: owner ของ fixture B เห็นทุกสาขา ไม่มี cookie sis_branch เลยได้สาขาแรกตามชื่อ (ZTA ของ orchestrator) แล้ว UI ตั้งค่าเขียนลงสาขานั้น
- หลักฐาน: booking_blackouts ZTA 2026-09-30 reason "muea1kes ปิดร้าน" สร้าง 15:47 UTC ระหว่าง worker B รัน
- กฎ: fixture ที่แยกกันต่อ worker ต้องปักสาขาที่ทำงาน (cookie/param) ให้ทุกบทบาทที่เห็นหลายสาขา ไม่ใช่พึ่งค่าเริ่มต้น
- status: new

## L-007 · 2026-09-24 · kp-autonomous-loop · gate-exit-code
- symptom: a commit was pushed after 'npm run typecheck | grep -c error' printed 39
- cause: the gate ran as one line joined with ';' so a red typecheck did not stop git commit/push; the errors were only in .next/dev/types left half-written by a killed Playwright dev server
- evidence: .next/dev/types/routes.d.ts TS1002 Unterminated string literal; source tree clean after regenerating
- rule: gate commands are chained with && on the typecheck exit code, never piped through grep; remove .next/dev/types when tsc errors point only there
- status: new
