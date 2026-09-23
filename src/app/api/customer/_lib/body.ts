import 'server-only'
import type { NextRequest } from 'next/server'

/** Every customer POST/PATCH body is capped at 4 KB (CLAUDE.md security rule #5). */
export const MAX_BODY_BYTES = 4096

export type BodyResult<T> = { ok: true; body: T } | { ok: false; status: 400 | 413 }

/** Reads and size-limits a JSON body. 413 before 400 — an oversized body is refused before it is even parsed. */
export async function readJsonBody<T>(req: NextRequest): Promise<BodyResult<T>> {
  const len = req.headers.get('content-length')
  if (len && Number(len) > MAX_BODY_BYTES) return { ok: false, status: 413 }
  const text = await req.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false, status: 413 }
  if (!text) return { ok: true, body: {} as T }
  try {
    return { ok: true, body: JSON.parse(text) as T }
  } catch {
    return { ok: false, status: 400 }
  }
}
