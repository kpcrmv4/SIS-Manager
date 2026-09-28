import 'server-only'
import { randomUUID } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getDepositDetail } from '@/lib/deposit/detail'
import { businessNight } from '@/lib/date'
import { isBarOrOwner } from '@/lib/auth/actor'
import type { ToolCtx } from './tools'
import type { Proposal, ProposalCall, ProposalField, ProposalKind } from './proposal-types'

/**
 * R-071 phase 2: the assistant prepares an action as a card; nothing changes until the person
 * presses ยืนยัน on it. Each builder looks the record up with the person's own session, checks
 * the state the action needs, and returns either a card or a plain reason the model can relay.
 */
type Built = { ok: true; proposal: Proposal } | { ok: false; reason: string }
type Json = Record<string, unknown>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN)
const nums = (v: unknown) => (Array.isArray(v) ? v.map(num).filter((n) => Number.isFinite(n)) : [])

const deposit = { type: 'object', properties: { code: { type: 'string', description: 'DEP code' } }, required: ['code'] } as const

const ALL_TOOLS: (Anthropic.Beta.BetaTool & { barOwner?: boolean })[] = [
  {
    name: 'propose_withdrawal',
    description: 'Prepare a withdrawal request for bottles of a deposit (the customer drinks in the shop, or takes them home). Ask which bottles and in-store or take-home first when unclear.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        bottles: { type: 'array', items: { type: 'integer' }, description: 'bottle numbers; may be omitted only when one bottle is free' },
        type: { type: 'string', enum: ['in_store', 'take_home'] },
        table: { type: 'string' },
      },
      required: ['code', 'type'],
    },
  },
  { name: 'propose_complete_withdrawal', barOwner: true, description: 'Prepare confirming the waiting withdrawal request of a deposit (bar/owner hand the bottle over).', input_schema: deposit },
  {
    name: 'propose_reject_withdrawal',
    barOwner: true,
    description: 'Prepare rejecting the waiting withdrawal request of a deposit, with a reason.',
    input_schema: { type: 'object', properties: { code: { type: 'string' }, reason: { type: 'string' } }, required: ['code', 'reason'] },
  },
  {
    name: 'propose_extend',
    barOwner: true,
    description: 'Prepare extending a deposit’s expiry by a number of days.',
    input_schema: { type: 'object', properties: { code: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 365 } }, required: ['code', 'days'] },
  },
  {
    name: 'propose_vip',
    barOwner: true,
    description: 'Prepare turning VIP (never expires) on or off for a deposit.',
    input_schema: { type: 'object', properties: { code: { type: 'string' }, vip: { type: 'boolean' } }, required: ['code', 'vip'] },
  },
  {
    name: 'propose_reject_deposit',
    barOwner: true,
    description: 'Prepare rejecting (cancelling) a deposit that is still a LINE request or waiting for bar to confirm, with a reason.',
    input_schema: { type: 'object', properties: { code: { type: 'string' }, reason: { type: 'string' } }, required: ['code', 'reason'] },
  },
  {
    name: 'propose_deposit_form',
    description:
      'Prepare a new deposit: opens the รับฝากเหล้า form filled in with these details, where the person adds the photo and saves. Several liquors become several items (one DEP code each).',
    input_schema: {
      type: 'object',
      properties: {
        customer: { type: 'string' },
        phone: { type: 'string' },
        table: { type: 'string' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: { type: 'object', properties: { name: { type: 'string' }, bottles: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['name', 'bottles'] },
        },
      },
      required: ['customer', 'items'],
    },
  },
  {
    name: 'propose_booking',
    description: 'Prepare a table booking taken by staff (phone or walk-in). night is the business night YYYY-MM-DD; time HH:MM.',
    input_schema: {
      type: 'object',
      properties: {
        night: { type: 'string' },
        time: { type: 'string' },
        party: { type: 'integer', minimum: 1 },
        name: { type: 'string' },
        phone: { type: 'string' },
        zone: { type: 'string', description: 'zone name, optional' },
        table: { type: 'string', description: 'table label, optional' },
        note: { type: 'string' },
      },
      required: ['night', 'time', 'party', 'name'],
    },
  },
  {
    name: 'propose_confirm_booking',
    barOwner: true,
    description: 'Prepare confirming a booking that waits for the shop, optionally giving it a table (label).',
    input_schema: { type: 'object', properties: { code: { type: 'string', description: 'BK code' }, table: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'propose_reject_booking',
    barOwner: true,
    description: 'Prepare rejecting a booking that waits for the shop, with a reason (the customer is told in LINE).',
    input_schema: { type: 'object', properties: { code: { type: 'string' }, reason: { type: 'string' } }, required: ['code', 'reason'] },
  },
  {
    name: 'propose_cancel_booking',
    description: 'Prepare cancelling a booking (waiting or confirmed), with an optional reason.',
    input_schema: { type: 'object', properties: { code: { type: 'string' }, reason: { type: 'string' } }, required: ['code'] },
  },
  { name: 'propose_check_in', description: 'Prepare checking in a booking whose customer has arrived.', input_schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
]

export function proposalToolsFor(role: ToolCtx['role']): Anthropic.Beta.BetaTool[] {
  return ALL_TOOLS.filter((t) => !t.barOwner || isBarOrOwner(role)).map((t) => {
    const { barOwner, ...tool } = t
    void barOwner
    return tool
  })
}

export function isProposalTool(name: string): boolean {
  return ALL_TOOLS.some((t) => t.name === name)
}

const card = (kind: ProposalKind, fields: ProposalField[], call: ProposalCall, link?: string): Built => ({
  ok: true,
  proposal: { id: randomUUID(), kind, fields: fields.filter((f) => f.value !== ''), call, link },
})

async function depositByCode(ctx: ToolCtx, raw: unknown) {
  const code = str(raw, 30).toUpperCase()
  if (!code) return null
  const sb = await getSupabaseServer()
  const { data } = await sb.from('deposits').select('id').eq('branch_id', ctx.branchId).eq('code', code).maybeSingle()
  return data ? getDepositDetail(ctx.branchId, data.id) : null
}

async function bookingByCode(ctx: ToolCtx, raw: unknown) {
  const code = str(raw, 30).toUpperCase()
  if (!code) return null
  const sb = await getSupabaseServer()
  const { data } = await sb
    .from('bookings')
    .select('id, code, status, night, slot_time, party_size, name, table:tables(label)')
    .eq('branch_id', ctx.branchId)
    .eq('code', code)
    .maybeSingle()
  return data as { id: string; code: string; status: string; night: string; slot_time: string; party_size: number; name: string; table: { label: string } | null } | null
}

async function tableByLabel(ctx: ToolCtx, raw: unknown) {
  const label = str(raw, 20)
  if (!label) return null
  const sb = await getSupabaseServer()
  const { data } = await sb.from('tables').select('id, label, zone_id').eq('branch_id', ctx.branchId).eq('active', true).ilike('label', label).limit(1).maybeSingle()
  return data
}

async function zoneByName(ctx: ToolCtx, raw: unknown) {
  const name = str(raw, 60)
  if (!name) return null
  const sb = await getSupabaseServer()
  const { data } = await sb.from('table_zones').select('id, name').eq('branch_id', ctx.branchId).eq('active', true).ilike('name', `%${name.replace(/[%_]/g, '')}%`).limit(1).maybeSingle()
  return data
}

const bookingFields = (b: NonNullable<Awaited<ReturnType<typeof bookingByCode>>>): ProposalField[] => [
  { key: 'code', value: b.code },
  { key: 'name', value: b.name },
  { key: 'night', value: b.night },
  { key: 'time', value: b.slot_time.slice(0, 5) },
  { key: 'party', value: String(b.party_size) },
]

export async function buildProposal(name: string, input: unknown, ctx: ToolCtx): Promise<Built> {
  const inp = (input && typeof input === 'object' ? input : {}) as Json
  const barOwner = isBarOrOwner(ctx.role)
  const tool = ALL_TOOLS.find((t) => t.name === name)
  if (!tool) return { ok: false, reason: `unknown tool ${name}` }
  if (tool.barOwner && !barOwner) return { ok: false, reason: 'only bar or owner can do this — tell the person who does it' }

  switch (name) {
    case 'propose_withdrawal': {
      const d = await depositByCode(ctx, inp.code)
      if (!d) return { ok: false, reason: `no deposit ${str(inp.code, 30)} in this branch` }
      if (d.status !== 'in_store' && d.status !== 'pending_withdrawal') return { ok: false, reason: `deposit is ${d.status}; bottles can be withdrawn only while in the shop` }
      const waiting = new Set(d.pendingWithdrawals.map((w) => w.bottleId))
      const free = d.bottles.filter((b) => b.status !== 'consumed' && !waiting.has(b.id))
      if (!free.length) return { ok: false, reason: 'every bottle left already has a waiting request — nothing to ask again' }
      const wanted = nums(inp.bottles)
      const picked = wanted.length ? free.filter((b) => wanted.includes(b.bottleNo)) : free.length === 1 ? free : []
      if (!picked.length || picked.length !== (wanted.length || 1)) {
        return { ok: false, reason: `ask which bottles: free bottles are ${free.map((b) => `${b.bottleNo} (${Math.round(b.remainingPercent)}%)`).join(', ')}; already requested: ${d.pendingWithdrawals.map((w) => w.bottleNo).join(', ') || 'none'}` }
      }
      const type = inp.type === 'take_home' ? 'take_home' : inp.type === 'in_store' ? 'in_store' : null
      if (!type) return { ok: false, reason: 'ask: drink in the shop or take home?' }
      const table = str(inp.table, 20) || d.tableLabel || ''
      return card(
        'withdraw',
        [
          { key: 'code', value: d.code },
          { key: 'item', value: d.itemName },
          { key: 'customer', value: d.customerName },
          { key: 'bottles', value: picked.map((b) => `${b.bottleNo} (${Math.round(b.remainingPercent)}%)`).join(', ') },
          { key: 'type', value: type, tr: true },
          { key: 'table', value: table },
        ],
        { fn: 'requestWithdrawal', args: { depositId: d.id, bottleIds: picked.map((b) => b.id), type, table } },
        `/deposits/${d.id}`,
      )
    }
    case 'propose_complete_withdrawal':
    case 'propose_reject_withdrawal': {
      const d = await depositByCode(ctx, inp.code)
      if (!d) return { ok: false, reason: `no deposit ${str(inp.code, 30)} in this branch` }
      if (!d.pendingWithdrawals.length) return { ok: false, reason: 'this deposit has no waiting withdrawal request' }
      const ids = d.pendingWithdrawals.map((w) => w.id)
      const fields: ProposalField[] = [
        { key: 'code', value: d.code },
        { key: 'item', value: d.itemName },
        { key: 'customer', value: d.customerName },
        { key: 'bottles', value: d.pendingWithdrawals.map((w) => String(w.bottleNo ?? '—')).join(', ') },
        { key: 'type', value: d.pendingWithdrawals[0].type, tr: true },
        { key: 'table', value: d.pendingWithdrawals[0].tableLabel ?? '' },
      ]
      if (name === 'propose_complete_withdrawal') return card('completeWithdrawal', fields, { fn: 'completeWithdrawals', args: { withdrawalIds: ids, depositId: d.id } }, `/deposits/${d.id}`)
      const reason = str(inp.reason, 200)
      if (!reason) return { ok: false, reason: 'ask for the reason' }
      return card('rejectWithdrawal', [...fields, { key: 'reason', value: reason }], { fn: 'rejectWithdrawal', args: { withdrawalIds: ids, depositId: d.id, reason } }, `/deposits/${d.id}`)
    }
    case 'propose_extend': {
      const d = await depositByCode(ctx, inp.code)
      if (!d) return { ok: false, reason: `no deposit ${str(inp.code, 30)} in this branch` }
      if (d.isVip) return { ok: false, reason: 'this deposit is VIP and never expires' }
      if (d.status !== 'in_store' && d.status !== 'pending_withdrawal') return { ok: false, reason: `deposit is ${d.status}; only a deposit in the shop can be extended` }
      const days = num(inp.days)
      if (!(days >= 1 && days <= 365)) return { ok: false, reason: 'days must be 1-365' }
      return card(
        'extend',
        [
          { key: 'code', value: d.code },
          { key: 'item', value: d.itemName },
          { key: 'customer', value: d.customerName },
          { key: 'expires', value: d.expiresAt ? d.expiresAt.slice(0, 10) : '' },
          { key: 'days', value: String(days) },
        ],
        { fn: 'extendDeposit', args: { depositId: d.id, days } },
        `/deposits/${d.id}`,
      )
    }
    case 'propose_vip': {
      const d = await depositByCode(ctx, inp.code)
      if (!d) return { ok: false, reason: `no deposit ${str(inp.code, 30)} in this branch` }
      const vip = inp.vip === true
      if (d.isVip === vip) return { ok: false, reason: `VIP is already ${vip ? 'on' : 'off'}` }
      return card(
        'vip',
        [
          { key: 'code', value: d.code },
          { key: 'item', value: d.itemName },
          { key: 'customer', value: d.customerName },
          { key: 'vip', value: vip ? 'on' : 'off', tr: true },
        ],
        { fn: 'setVip', args: { depositId: d.id, vip } },
        `/deposits/${d.id}`,
      )
    }
    case 'propose_reject_deposit': {
      const d = await depositByCode(ctx, inp.code)
      if (!d) return { ok: false, reason: `no deposit ${str(inp.code, 30)} in this branch` }
      if (d.status !== 'requested' && d.status !== 'pending_confirm') return { ok: false, reason: `deposit is ${d.status}; only a LINE request or one waiting for bar can be rejected` }
      const reason = str(inp.reason, 200)
      if (!reason) return { ok: false, reason: 'ask for the reason' }
      return card(
        'rejectDeposit',
        [
          { key: 'code', value: d.code },
          { key: 'item', value: d.itemName },
          { key: 'customer', value: d.customerName },
          { key: 'reason', value: reason },
        ],
        { fn: 'rejectDeposit', args: { depositId: d.id, reason } },
        `/deposits/${d.id}`,
      )
    }
    case 'propose_deposit_form': {
      const customer = str(inp.customer, 120)
      const items = (Array.isArray(inp.items) ? inp.items : [])
        .slice(0, 10)
        .map((x) => ({ name: str((x as Json)?.name, 120), bottles: num((x as Json)?.bottles) }))
        .filter((x) => x.name && x.bottles >= 1 && x.bottles <= 50)
      if (!customer) return { ok: false, reason: 'ask for the customer name' }
      if (!items.length) return { ok: false, reason: 'ask which liquor and how many bottles' }
      const q = new URLSearchParams({ name: customer })
      const phone = str(inp.phone, 20)
      const table = str(inp.table, 20)
      if (phone) q.set('phone', phone)
      if (table) q.set('table', table)
      q.set('items', items.map((i) => `${i.name.replace(/[|*]/g, ' ')}*${i.bottles}`).join('|'))
      return card(
        'depositForm',
        [
          { key: 'customer', value: customer },
          { key: 'phone', value: phone },
          { key: 'table', value: table },
          { key: 'items', value: items.map((i) => `${i.name} × ${i.bottles}`).join(' · ') },
        ],
        { fn: 'openDepositForm', args: { href: `/deposits/new?${q.toString()}` } },
      )
    }
    case 'propose_booking': {
      const night = str(inp.night, 10)
      const time = str(inp.time, 5)
      const party = num(inp.party)
      const nm = str(inp.name, 120)
      if (!DATE_RE.test(night)) return { ok: false, reason: 'night must be YYYY-MM-DD' }
      if (night < businessNight()) return { ok: false, reason: 'that night has passed' }
      if (!TIME_RE.test(time)) return { ok: false, reason: 'time must be HH:MM' }
      if (!(party >= 1)) return { ok: false, reason: 'ask how many people' }
      if (!nm) return { ok: false, reason: 'ask for the name' }
      const t = str(inp.table, 20) ? await tableByLabel(ctx, inp.table) : null
      if (str(inp.table, 20) && !t) return { ok: false, reason: `no table labelled ${str(inp.table, 20)}` }
      const z = !t && str(inp.zone, 60) ? await zoneByName(ctx, inp.zone) : null
      if (!t && str(inp.zone, 60) && !z) return { ok: false, reason: `no zone named ${str(inp.zone, 60)}` }
      const phone = str(inp.phone, 20)
      const note = str(inp.note, 300)
      return card(
        'book',
        [
          { key: 'name', value: nm },
          { key: 'phone', value: phone },
          { key: 'night', value: night },
          { key: 'time', value: time },
          { key: 'party', value: String(party) },
          { key: 'table', value: t?.label ?? '' },
          { key: 'zone', value: z?.name ?? '' },
          { key: 'note', value: note },
        ],
        {
          fn: 'createStaffBooking',
          args: { branchId: ctx.branchId, night, slot: time, party, name: nm, phone: phone || undefined, zoneId: t?.zone_id ?? z?.id ?? undefined, tableId: t?.id, note: note || undefined },
        },
        `/bookings?night=${night}`,
      )
    }
    case 'propose_confirm_booking':
    case 'propose_reject_booking':
    case 'propose_cancel_booking':
    case 'propose_check_in': {
      const b = await bookingByCode(ctx, inp.code)
      if (!b) return { ok: false, reason: `no booking ${str(inp.code, 30)} in this branch` }
      const link = `/bookings?night=${b.night}&b=${b.id}`
      if (name === 'propose_confirm_booking') {
        if (b.status !== 'pending') return { ok: false, reason: `booking is ${b.status}; only a waiting booking is confirmed` }
        const t = str(inp.table, 20) ? await tableByLabel(ctx, inp.table) : null
        if (str(inp.table, 20) && !t) return { ok: false, reason: `no table labelled ${str(inp.table, 20)}` }
        return card('confirmBooking', [...bookingFields(b), { key: 'table', value: t?.label ?? b.table?.label ?? '' }], { fn: 'confirmBooking', args: { bookingId: b.id, tableId: t?.id } }, link)
      }
      if (name === 'propose_reject_booking') {
        if (b.status !== 'pending') return { ok: false, reason: `booking is ${b.status}; only a waiting booking is rejected (cancel a confirmed one)` }
        const reason = str(inp.reason, 200)
        if (!reason) return { ok: false, reason: 'ask for the reason' }
        return card('rejectBooking', [...bookingFields(b), { key: 'reason', value: reason }], { fn: 'rejectBooking', args: { bookingId: b.id, reason } }, link)
      }
      if (name === 'propose_cancel_booking') {
        if (b.status !== 'pending' && b.status !== 'confirmed') return { ok: false, reason: `booking is ${b.status}; it cannot be cancelled` }
        const reason = str(inp.reason, 200)
        return card('cancelBooking', [...bookingFields(b), { key: 'reason', value: reason }], { fn: 'cancelBooking', args: { bookingId: b.id, reason: reason || undefined } }, link)
      }
      if (b.status !== 'confirmed' && b.status !== 'pending') return { ok: false, reason: `booking is ${b.status}; it cannot be checked in` }
      return card('checkIn', [...bookingFields(b), { key: 'table', value: b.table?.label ?? '' }], { fn: 'checkInBooking', args: { branchId: ctx.branchId, ref: b.code } }, link)
    }
  }
  return { ok: false, reason: `unknown tool ${name}` }
}
