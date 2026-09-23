/**
 * Chat keywords a customer can type to the branch OA → the reply kind the webhook sends.
 * Matched on the whole message (spaces, case and trailing punctuation ignored), in every
 * customer language regardless of the customer's own locale, so "จองโต๊ะ", "book" and
 * "预约" all work. Anything else is ordinary chat and gets no reply.
 */

export const KEYWORD_KINDS = ['kw_deposit', 'kw_withdraw', 'kw_bottles', 'kw_book', 'kw_tickets', 'kw_menu'] as const
export type KeywordKind = (typeof KEYWORD_KINDS)[number]

const WORDS: Record<KeywordKind, string[]> = {
  kw_deposit: ['ฝาก', 'ฝากเหล้า', 'ฝากขวด', 'ขอฝาก', 'ขอฝากเหล้า', 'deposit', '寄存', '寄酒', '存酒', '맡기기', '술맡기기', '보관'],
  kw_withdraw: ['เบิก', 'เบิกเหล้า', 'เบิกขวด', 'ขอเบิก', 'ขอเบิกเหล้า', 'withdraw', '取酒', '取出', '찾기', '술찾기', '인출'],
  kw_bottles: ['ขวดของฉัน', 'เหล้าของฉัน', 'ดูขวด', 'ดูเหล้า', 'เหล้าที่ฝาก', 'mybottles', 'bottles', '我的酒', '내술'],
  kw_book: ['จอง', 'จองโต๊ะ', 'ขอจอง', 'ขอจองโต๊ะ', 'book', 'booking', 'reserve', 'reservation', '订位', '訂位', '预约', '預約', '예약', '테이블예약'],
  kw_tickets: ['ตั๋ว', 'ตั๋วจอง', 'บัตรจอง', 'ตั๋วของฉัน', 'การจองของฉัน', 'ticket', 'tickets', 'mybooking', 'mybookings', '我的预约', '我的預約', '내예약', '예약확인'],
  kw_menu: ['เมนู', 'ช่วยเหลือ', 'menu', 'help', '菜单', '選單', '帮助', '메뉴', '도움말'],
}

const norm = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s​]+/g, '')
    .replace(/[.!?。！？~]+$/u, '')

const INDEX = new Map<string, KeywordKind>()
for (const [kind, words] of Object.entries(WORDS) as [KeywordKind, string[]][]) for (const w of words) INDEX.set(norm(w), kind)

/** Whole-message match: "จองโต๊ะครับ" and "Book!" are keywords, "อยากจองโต๊ะพรุ่งนี้" is not. */
export function matchKeyword(message: string): KeywordKind | null {
  if (message.length > 40) return null
  const key = norm(message).replace(/(ครับ|ค่ะ|คะ|จ้า|นะ)+$/u, '')
  return INDEX.get(key) ?? null
}
