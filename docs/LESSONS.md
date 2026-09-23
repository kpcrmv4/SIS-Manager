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
