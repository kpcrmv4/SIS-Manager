import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { getSupabaseServer } from '@/lib/supabase/server'
import { DEPOSIT_TABS, depositTabCounts, listDeposits, type DepositTab } from '@/lib/deposit/list'
import { getDepositDetail } from '@/lib/deposit/detail'
import { nightBookings } from '@/lib/booking/queries'
import { manualFor, manualForRole } from '@/lib/manual'
import { addDays, businessNight } from '@/lib/date'
import type { Role } from '@/lib/auth/actor'

/**
 * R-070 phase 1: the assistant only reads. Every tool runs with the signed-in user's own
 * Supabase session in the branch they are working in, so RLS and the role checks decide
 * what comes back — the same rows the user's own screens show.
 */
export type ToolCtx = { branchId: string; role: Role; locale: 'th' | 'en' }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CODE_RE = /^[A-Z0-9-]{4,30}$/

export const AI_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'read_manual',
    description:
      'Read sections of the app manual (steps for each task, what is on each page, important rules). Use it before explaining how to do anything in the app. Pass section ids from the manual contents in the system prompt; up to 4 per call.',
    input_schema: {
      type: 'object',
      properties: { sections: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 } },
      required: ['sections'],
    },
  },
  {
    name: 'find_deposits',
    description:
      'Search the liquor deposits of the current branch by customer name, phone or DEP code, optionally within one list tab. Returns up to 20 rows with a link path for each.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'name, phone or code; empty for the whole tab' },
        tab: { type: 'string', enum: DEPOSIT_TABS, description: 'inStore · toConfirm (bar to confirm) · withdraw (withdrawal requested) · requests (LINE requests) · expired · closed' },
      },
    },
  },
  {
    name: 'get_deposit',
    description: 'One deposit by its DEP code: every bottle and its level, waiting withdrawal requests, expiry, and the latest history.',
    input_schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'list_bookings',
    description: 'Table bookings of the current branch for one night (the business night; a 01:30 arrival belongs to the night before). Defaults to tonight.',
    input_schema: { type: 'object', properties: { night: { type: 'string', description: 'YYYY-MM-DD' } } },
  },
  {
    name: 'tonight_summary',
    description: 'Counts for the current branch right now: deposits per list tab, and tonight’s bookings per status.',
    input_schema: { type: 'object', properties: {} },
  },
]

type Json = Record<string, unknown>
const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function flattenSection(ctx: ToolCtx, id: string): string | null {
  const m = manualFor(ctx.locale)
  const found = manualForRole(m, ctx.role).flatMap((g) => g.sections).find((s) => s.id === id)
  if (!found) return null
  const s = found.section
  const lines = [`# ${s.title} (${s.path})`, s.intro]
  if (s.onPage.length) lines.push(`${m.labels.onPage}:`, ...s.onPage.map((x) => `- ${x}`))
  for (const [, h] of found.howtos) lines.push(`## ${h.title}`, ...h.steps.map((x, i) => `${i + 1}. ${x}`))
  if (s.important.length) lines.push(`${m.labels.important}:`, ...s.important.map((x) => `- ${x}`))
  if (s.tips.length) lines.push(`${m.labels.tip}:`, ...s.tips.map((x) => `- ${x}`))
  return lines.join('\n')
}

async function depositIdByCode(ctx: ToolCtx, code: string): Promise<string | null> {
  const sb = await getSupabaseServer()
  const { data } = await sb.from('deposits').select('id').eq('branch_id', ctx.branchId).eq('code', code).maybeSingle()
  return data?.id ?? null
}

export async function runTool(name: string, input: unknown, ctx: ToolCtx): Promise<{ content: string; isError?: boolean }> {
  const inp = (input && typeof input === 'object' ? input : {}) as Json
  switch (name) {
    case 'read_manual': {
      const ids = Array.isArray(inp.sections) ? inp.sections.filter((s): s is string => typeof s === 'string').slice(0, 4) : []
      if (!ids.length) return { content: 'sections required', isError: true }
      const out = ids.map((id) => flattenSection(ctx, id) ?? `(${id}: not in the manual for this role)`)
      return { content: out.join('\n\n') }
    }
    case 'find_deposits': {
      const q = str(inp.query, 60)
      const tab = DEPOSIT_TABS.includes(inp.tab as DepositTab) ? (inp.tab as DepositTab) : null
      const tabs = tab ? [tab] : q ? DEPOSIT_TABS : (['inStore'] as DepositTab[])
      const rows: Json[] = []
      for (const t of tabs) {
        const { rows: found, total } = await listDeposits(ctx.branchId, t, q, 1)
        for (const r of found) {
          if (rows.length >= 20) break
          rows.push({
            tab: t,
            code: r.code,
            customer: r.customerName,
            phone: r.customerPhone,
            item: r.itemName,
            bottles_left: `${r.remainingQty}/${r.quantity}`,
            level_percent: Math.round(r.remainingPercent),
            status: r.status,
            vip: r.isVip,
            expires_at: r.expiresAt,
            table: r.tableLabel,
            path: `/deposits/${r.id}`,
          })
        }
        if (tab) rows.push({ total_in_tab: total })
        if (rows.length >= 20) break
      }
      return { content: JSON.stringify(rows) }
    }
    case 'get_deposit': {
      const code = str(inp.code, 30).toUpperCase()
      if (!CODE_RE.test(code)) return { content: 'bad code', isError: true }
      const id = await depositIdByCode(ctx, code)
      if (!id) return { content: `no deposit ${code} in this branch` }
      const d = await getDepositDetail(ctx.branchId, id)
      if (!d) return { content: `no deposit ${code} in this branch` }
      return {
        content: JSON.stringify({
          code: d.code,
          path: `/deposits/${d.id}`,
          status: d.status,
          vip: d.isVip,
          customer: d.customerName,
          phone: d.customerPhone,
          linked_line: Boolean(d.customerId),
          item: d.itemName,
          table: d.tableLabel,
          expires_at: d.expiresAt,
          bottles: d.bottles.map((b) => ({ no: b.bottleNo, percent: Math.round(b.remainingPercent), status: b.status })),
          waiting_withdrawals: d.pendingWithdrawals.map((w) => ({ bottle: w.bottleNo, type: w.type, table: w.tableLabel, by: w.byCustomer ? 'customer via LINE' : w.requestedBy, at: w.createdAt })),
          history: d.events.slice(0, 8).map((e) => ({ action: e.action, at: e.createdAt, by: e.actorName ?? e.actorKind })),
        }),
      }
    }
    case 'list_bookings': {
      const night = DATE_RE.test(str(inp.night, 10)) ? str(inp.night, 10) : businessNight()
      const { bookings, error } = await nightBookings(ctx.branchId, night)
      if (error) return { content: 'could not load bookings', isError: true }
      return {
        content: JSON.stringify({
          night,
          bookings: bookings.slice(0, 60).map((b) => ({
            code: b.code,
            time: b.slotTime.slice(0, 5),
            name: b.name,
            party: b.party,
            zone: b.zoneName,
            table: b.tableLabel,
            status: b.status,
            source: b.source,
            note: b.note,
            path: `/bookings?night=${night}&b=${b.id}`,
          })),
        }),
      }
    }
    case 'tonight_summary': {
      const night = businessNight()
      const [counts, { bookings }] = await Promise.all([depositTabCounts(ctx.branchId), nightBookings(ctx.branchId, night)])
      const byStatus: Record<string, number> = {}
      for (const b of bookings) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1
      return { content: JSON.stringify({ night, tomorrow: addDays(night, 1), deposits_per_tab: counts, bookings_tonight: byStatus }) }
    }
    default:
      return { content: `unknown tool ${name}`, isError: true }
  }
}
