/**
 * What a scanned or typed string refers to. Receipt QRs are LIFF links that carry the
 * deposit code (`…?link=DEP-RMI-7K2QX`), so the code is searched anywhere in the string;
 * booking QRs carry only the 32-hex token (never the booking number).
 */
export type ScanRef =
  | { kind: 'deposit_code'; value: string }
  | { kind: 'booking_token'; value: string }
  | { kind: 'booking_code'; value: string }
  | { kind: 'table'; value: string }
  | { kind: 'none' }

export function parseScan(raw: string): ScanRef {
  const s = (raw ?? '').trim()
  if (!s || s.length > 512) return { kind: 'none' }
  const dep = s.toUpperCase().match(/DEP-[A-Z]{2,5}-[A-Z0-9]{5}/)
  if (dep) return { kind: 'deposit_code', value: dep[0] }
  if (/^[0-9a-f]{32}$/i.test(s)) return { kind: 'booking_token', value: s.toLowerCase() }
  const bk = s.toUpperCase().match(/^BK-\d{4}-\d{3}$/)
  if (bk) return { kind: 'booking_code', value: bk[0] }
  if (/^[A-Za-z0-9ก-๙ ._-]{1,12}$/.test(s)) return { kind: 'table', value: s }
  return { kind: 'none' }
}
