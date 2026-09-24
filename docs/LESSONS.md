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

## L-007 · 2026-09-24 · kp-autonomous-loop · false-exit-0
- อาการ: commit ถูก push ไปแล้วทั้งที่ npm run typecheck | grep -c error พิมพ์ 39
- สาเหตุ: gate เขียนเป็นบรรทัดเดียวคั่นด้วย ; และส่งผ่าน grep — typecheck แดงจึงไม่หยุด git commit/push · error ทั้งหมดอยู่ใน .next/dev/types ที่ dev server ของ Playwright ถูกฆ่ากลางการเขียน
- หลักฐาน: .next/dev/types/routes.d.ts TS1002 Unterminated string literal · source สะอาดหลังลบโฟลเดอร์แล้ว typegen ใหม่
- กฎ: gate ต่อกันด้วย && ตาม exit code ของ typecheck เท่านั้น ห้ามตัดสินผ่านจากผลของ grep
- status: new

## L-008 · 2026-09-24 · kp-autonomous-loop · shell-writes-code
- อาการ: สคริปต์แก้ spec วางหัวไฟล์ทั้งก้อนลงกลางบรรทัดหนึ่ง
- สาเหตุ: String.replaceAll(str, สตริงแทนที่) ตีความ $` เป็น "ข้อความก่อนจุดที่เจอ" — สตริงแทนที่มี template literal ที่ลงท้ายด้วย ${A_CODE}$`
- หลักฐาน: tests/e2e/P3-A2.spec.ts บรรทัด 196 มีบล็อก import ต่อท้าย regex · กู้จาก git แล้วทำใหม่
- กฎ: สคริปต์ดูแลไฟล์ใช้ replacer function (หรือ split/join) ทุกครั้งที่ข้อความแทนที่อาจมี $
- status: new

## L-009 · 2026-09-24 · kp-e2e-playwright-real-db · env-drift
- อาการ: P3-A2-02 ได้ skipped และ P3-A3-03 ไม่มี reply ทั้งที่ renderer คืน flex ปกติเมื่อลองแยก
- สาเหตุ: dev server ของเทสต์เริ่มโดยไม่มี LINE_API_BASE จึงยิง api.line.me จริงด้วย token ปลอม (401 → skipped) · รอบสองตั้งพอร์ต mock ผิดเพราะ E2E_PORT ไม่ได้ตั้ง
- หลักฐาน: mock ฟังที่ 4000 (PORT 3000 + 1000) ไม่ใช่ 4107 · หลังตั้ง webServer.env ใน playwright.config ผ่าน 26/26 โดยไม่ตั้งค่าใน shell
- กฎ: env ที่เทสต์ขาดไม่ได้ (URL ของ mock) ต้องตั้งใน playwright.config webServer.env จากพอร์ตเดียวกับ mock ไม่ใช่พึ่งคำสั่ง shell
- status: new

## L-010 · 2026-09-24 · kp-seed-and-reset · cleanup-deletes-cited
- อาการ: เกือบใช้ wipe-all ล้าง fixture หลังเทสต์ ขณะสาขาเดโม SRC มี token และ LIFF ของ LINE OA จริงแล้ว
- สาเหตุ: wipe-all ตัดสินว่าลบได้จากป้าย receipt_settings.demo อย่างเดียว · เจ้าของตั้งค่า LINE จริงบนสาขาเดโมทีหลัง ป้ายเดโมไม่ได้แปลว่าไม่มีค่าจริง
- หลักฐาน: branch_line_secrets ของ SRC มี token + secret · แก้ด้วย scripts/clean-e2e.mjs (ลบเฉพาะ fixture) และ guard --include-line-config ใน wipe-all
- กฎ: งานล้างหลังเทสต์ต้องจำกัดที่ fixture ของเทสต์เอง ส่วน full reset ต้องปฏิเสธเมื่อเจอค่าที่คนตั้งทีหลัง (secret, LIFF) เว้นมีธงยืนยัน
- status: new

## L-011 · 2026-09-24 · kp-testing-cadence · false-green
- อาการ: ภาพหน้าจอหน้ารายงานบนมือถือล้น 0 px แต่ช่วง 62 วัน แท่งวันล่าสุดหลุดขอบขวาและทั้งหน้าเลื่อนแนวนอนได้
- สาเหตุ: ภาพหน้าจอใช้ค่าเริ่มต้น (เดือนนี้ 24 แท่ง) ที่พอดีจออยู่แล้ว · min-width ของแถวแท่งไม่ได้บวก gap และการ์ดใน grid ไม่มี min-w-0 จึงล้นเมื่อแท่งกว้างกว่าจอ
- หลักฐาน: tests/e2e/P4-01-reports.spec.ts P4-01-23 on a phone · ol 682 แต่แท่งใช้ 864 · แท่งสุดท้าย x=529 บนจอ 390 → หลังแก้ x=347 หน้าไม่ล้น
- กฎ: ตรวจ layout ของสิ่งที่กว้างตามจำนวนข้อมูลด้วยชุดข้อมูลที่กว้างที่สุดที่หน้านั้นรับได้ ไม่ใช่ค่าเริ่มต้นที่พอดีจออยู่แล้ว
- status: new

## L-012 · 2026-09-24 · thai-admin-page-kit · project-only
- อาการ: modal ยกเลิกการจองใน LIFF ยืดยาวเกือบเต็มจอ ทั้งที่มีแค่หัวข้อกับปุ่มสองปุ่ม · sheet ขอเบิกและเลือกภาษาก็เป็นเหมือนกัน
- สาเหตุ: คลาส .cx ใช้ทั้งเป็นที่เก็บ token สีและเป็นสไตล์ของหน้า (min-height: 100dvh) · overlay ใส่ .cx เพื่อให้ได้สีใน portal เลยได้ความสูงเต็มจอไปด้วย ซึ่งชนะ max-h ของ sheet
- หลักฐาน: src/app/ui.css .cx { min-height: 100dvh } · P2-C3-03 วัดความสูง dialog ได้เท่าจอเมื่อยังใช้ .cx · แยกเป็น .cx (token) + .cx-page (หน้า) และ portal เข้า root ของ LIFF
- กฎ: คลาสที่ใช้ส่งต่อ token ให้ portal ต้องมีแต่ตัวแปรสีเท่านั้น ส่วนสไตล์ของหน้าต้องอยู่ในคลาสที่ใช้เฉพาะ root ของหน้า
- status: project-only

## L-013 · 2026-09-24 · kp-testing-cadence · flaky
- อาการ: P3-A2-05 ผ่านตอนรันเดี่ยว แต่ล้มตอนรันทั้งชุด · mock LINE ได้รับ push แล้ว แต่แถว outbox ยังเป็น sending ไม่ใช่ sent
- สาเหตุ: mock บันทึก request ทันทีที่มาถึง ก่อนที่ dispatcher จะได้คำตอบกลับไปแล้วเรียก finish_outbox · spec อ่านแถวครั้งเดียวทันทีหลัง mock เห็น push · เครื่องที่โหลดหนักทำให้ช่วงห่างนั้นยาวพอให้อ่านเจอ sending
- หลักฐาน: tests/e2e/P3-A2.spec.ts:161 Expected "sent" Received "sending" (full run 2026-09-24, 331 passed) · เปลี่ยนเป็น expect.poll จนเป็น sent แล้วผ่าน
- กฎ: เมื่อ mock เห็น request แล้ว สถานะฝั่งผู้ส่งยังอาจไม่อัปเดต ให้ poll สถานะสุดท้ายของผู้ส่ง อย่าอ่านครั้งเดียว
- status: new
