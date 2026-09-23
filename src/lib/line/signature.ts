import { createHmac, timingSafeEqual } from 'node:crypto'

/** X-Line-Signature = base64(HMAC-SHA256(raw request body, channel secret)). */
export function lineSignature(rawBody: Buffer | string, channelSecret: string): string {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64')
}

/** Constant-time check of the header against the raw bytes LINE sent (never re-serialised JSON). */
export function verifyLineSignature(rawBody: Buffer | string, channelSecret: string | null | undefined, header: string | null | undefined): boolean {
  if (!channelSecret || !header) return false
  const expected = Buffer.from(lineSignature(rawBody, channelSecret))
  const got = Buffer.from(header.trim())
  return expected.length === got.length && timingSafeEqual(expected, got)
}
