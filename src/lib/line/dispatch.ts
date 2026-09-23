import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import { pushMessage } from './client'
import { renderMessage } from './render'
import { dispatchPush } from '@/lib/push/dispatch'

type OutboxRow = Database['public']['Tables']['line_outbox']['Row']
type Outcome = 'sent' | 'failed' | 'skipped'
type BranchCtx = { token: string | null; liffId: string | null; name: string | null }

export type DispatchSummary = { claimed: number; sent: number; failed: number; skipped: number }

const BATCH = 50
const MAX_ROUNDS = 10
const BUDGET_MS = 25_000
const PARALLEL = 8

/**
 * Sends due LINE outbox rows (CLAUDE.md §5). claim_outbox marks a batch `sending`
 * (skip-locked, so the cron ping and an inline after() dispatch never send one row twice),
 * then each row ends in finish_outbox:
 *   2xx (or 409 = LINE already accepted this retry key) → sent
 *   no token / no target / unknown kind / other 4xx         → skipped (permanent, reason in `error`)
 *   429 / 5xx / no HTTP answer                               → failed (the SQL backs off 1-16 min)
 */
export async function dispatchOutbox(): Promise<DispatchSummary> {
  const admin = getSupabaseAdmin()
  const summary: DispatchSummary = { claimed: 0, sent: 0, failed: 0, skipped: 0 }
  const branches = new Map<string, BranchCtx>()
  const appBaseUrl = process.env.APP_BASE_URL || null
  const started = Date.now()

  for (let round = 0; round < MAX_ROUNDS && Date.now() - started < BUDGET_MS; round++) {
    const { data, error } = await admin.rpc('claim_outbox', { p_limit: BATCH })
    if (error) throw new Error(`claim_outbox: ${error.message}`)
    const rows = (data ?? []) as OutboxRow[]
    summary.claimed += rows.length
    if (!rows.length) break

    const missing = [...new Set(rows.map((r) => r.branch_id))].filter((id) => !branches.has(id))
    if (missing.length) {
      const [{ data: secrets, error: secretError }, { data: info, error: infoError }] = await Promise.all([
        admin.from('branch_line_secrets').select('branch_id, channel_access_token').in('branch_id', missing),
        admin.from('branches').select('id, liff_id, name').in('id', missing),
      ])
      if (secretError || infoError) throw new Error(`branch lookup: ${(secretError ?? infoError)!.message}`)
      for (const id of missing) {
        const s = (secrets ?? []).find((x) => x.branch_id === id)
        const b = (info ?? []).find((x) => x.id === id)
        branches.set(id, { token: s?.channel_access_token || null, liffId: b?.liff_id ?? null, name: b?.name ?? null })
      }
    }

    for (let i = 0; i < rows.length; i += PARALLEL) {
      const outcomes = await Promise.all(rows.slice(i, i + PARALLEL).map((row) => sendOne(row, branches.get(row.branch_id)!, appBaseUrl)))
      for (const [status, reason, row] of outcomes) {
        const { error: finishError } = await admin.rpc('finish_outbox', { p_id: row.id, p_status: status, p_error: reason ?? undefined })
        // a row we could not finish stays `sending` and is reclaimed in 5 minutes (LINE dedupes by retry key)
        if (finishError) continue
        summary[status]++
      }
    }
    if (rows.length < BATCH) break
  }
  return summary
}

async function sendOne(row: OutboxRow, branch: BranchCtx, appBaseUrl: string | null): Promise<[Outcome, string | null, OutboxRow]> {
  const message = renderMessage(row.kind, row.locale, row.payload, { liffId: branch.liffId, appBaseUrl, branchName: branch.name })
  if (!message) return ['skipped', `unknown_kind:${row.kind}`.slice(0, 100), row]
  if (!branch.token) return ['skipped', 'no_token: the branch has no LINE channel access token', row]
  if (!row.target?.trim()) return ['skipped', 'no_target', row]
  const r = await pushMessage(branch.token, row.target, [message], row.id)
  if (r.ok || r.status === 409) return ['sent', null, row]
  if (r.status === 0 || r.status === 429 || r.status >= 500) return ['failed', `HTTP ${r.status || 'network'}: ${r.message}`, row]
  return ['skipped', `HTTP ${r.status}: ${r.message}`, row]
}

type DispatchState = { running: Promise<void> | null; again: boolean }
const state: DispatchState = ((globalThis as { __sisLineDispatch?: DispatchState }).__sisLineDispatch ??= { running: null, again: false })

/**
 * Fire-and-forget dispatch for server code: call it inside Next's after() right after an RPC
 * that enqueues, so the message goes out without waiting for the cron ping. Never throws.
 * Calls that arrive while a run is in flight coalesce into one more run.
 */
export function dispatchSoon(): Promise<void> {
  if (state.running) {
    state.again = true
    return state.running
  }
  const run = async () => {
    do {
      state.again = false
      try {
        await dispatchOutbox()
      } catch {
        // the cron ping retries whatever is still queued
      }
      // the same state changes write in-app notifications (DB triggers) — push them now too
      try {
        await dispatchPush()
      } catch {
        // sis-push-dispatch cron picks up anything left within the hour
      }
    } while (state.again)
  }
  state.running = run().finally(() => {
    state.running = null
  })
  return state.running
}
