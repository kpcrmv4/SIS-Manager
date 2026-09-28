'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { dispatchSoon } from '@/lib/line/dispatch'
import { callRpc, cleanText, isUuid } from '@/lib/action'
import type { ActionResult } from '@/lib/errors'

/**
 * Deposit state changes — one server action per RPC (P1-05 contract). Screens call
 * these; the database decides who may do what. Every action revalidates the list,
 * the tonight board and the detail page it touched.
 */

function touched(id?: string) {
  revalidatePath('/deposits')
  revalidatePath('/tonight')
  if (id) revalidatePath(`/deposits/${id}`)
}

export type CreateDepositInput = {
  branchId: string
  customerName: string
  customerPhone?: string
  table?: string
  itemId?: string
  itemName: string
  category?: string
  quantity: number
  photoPaths: string[]
  notes?: string
  /** bar/owner only — the RPC refuses it for staff */
  expiresAt?: string
  /** R-059: what the staff said about a phone that is a LINE customer's — link to that owner, or a shared phone */
  phoneChoice?: { kind: 'owner'; customerId: string } | { kind: 'shared' }
}

export async function createDeposit(input: CreateDepositInput): Promise<ActionResult<{ id: string; code: string }>> {
  if (!isUuid(input.branchId) || !cleanText(input.customerName, 120) || !cleanText(input.itemName, 120)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; code: string }>((sb) =>
    sb.rpc('create_deposit_with_phone', {
      p_branch: input.branchId,
      p_customer_name: cleanText(input.customerName, 120)!,
      p_item_name: cleanText(input.itemName, 120)!,
      p_quantity: Math.trunc(input.quantity),
      p_photo_paths: input.photoPaths.slice(0, 10),
      p_customer_phone: cleanText(input.customerPhone, 20),
      p_table: cleanText(input.table, 20),
      p_item_id: isUuid(input.itemId) ? input.itemId : undefined,
      p_category: cleanText(input.category, 20),
      p_notes: cleanText(input.notes, 500),
      p_expires_at: input.expiresAt,
      // staff never name a customer: 'owner' links the one the database finds for this phone (R-059)
      p_phone_choice: input.phoneChoice?.kind,
      p_phone_customer: input.phoneChoice?.kind === 'owner' && isUuid(input.phoneChoice.customerId) ? input.phoneChoice.customerId : undefined,
    }),
  )
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
  return res
}

export type DepositItemInput = { itemId?: string; itemName: string; category?: string; quantity: number }
export type CreatedDeposit = { id: string; code: string; item: string; quantity: number }

/**
 * R-068: one form, 1-10 liquors — each its own deposit and DEP code, written in one transaction
 * (an error in any item saves none); the bell and push go out once for the batch.
 */
export async function createDeposits(
  input: Omit<CreateDepositInput, 'itemId' | 'itemName' | 'category' | 'quantity'> & { items: DepositItemInput[] },
): Promise<ActionResult<{ deposits: CreatedDeposit[] }>> {
  const items = input.items.map((i) => ({
    item_name: cleanText(i.itemName, 120),
    quantity: Math.trunc(i.quantity),
    item_id: isUuid(i.itemId) ? i.itemId : undefined,
    category: cleanText(i.category, 20),
  }))
  if (!isUuid(input.branchId) || !cleanText(input.customerName, 120) || !items.length || items.length > 10 || items.some((i) => !i.item_name || !Number.isFinite(i.quantity))) {
    return { ok: false, error: 'invalid' }
  }
  const res = await callRpc<{ deposits: CreatedDeposit[] }>((sb) =>
    sb.rpc('create_deposits', {
      p_branch: input.branchId,
      p_customer_name: cleanText(input.customerName, 120)!,
      p_items: items,
      p_photo_paths: input.photoPaths.slice(0, 10),
      p_customer_phone: cleanText(input.customerPhone, 20),
      p_table: cleanText(input.table, 20),
      p_notes: cleanText(input.notes, 500),
      p_expires_at: input.expiresAt,
      p_phone_choice: input.phoneChoice?.kind,
      p_phone_customer: input.phoneChoice?.kind === 'owner' && isUuid(input.phoneChoice.customerId) ? input.phoneChoice.customerId : undefined,
    }),
  )
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
  return res
}

export async function receiveRequest(input: {
  depositId: string
  quantity: number
  photoPaths: string[]
  itemName?: string
  itemId?: string
  table?: string
  customerPhone?: string
}): Promise<ActionResult<{ id: string; code: string }>> {
  if (!isUuid(input.depositId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; code: string }>((sb) =>
    sb.rpc('staff_receive_request', {
      p_deposit: input.depositId,
      p_quantity: Math.trunc(input.quantity),
      p_photo_paths: input.photoPaths.slice(0, 10),
      p_item_name: cleanText(input.itemName, 120),
      p_item_id: isUuid(input.itemId) ? input.itemId : undefined,
      p_table: cleanText(input.table, 20),
      p_customer_phone: cleanText(input.customerPhone, 20),
    }),
  )
  if (res.ok) {
    touched(input.depositId)
    after(() => dispatchSoon())
  }
  return res
}

export async function confirmDeposit(depositId: string, levels: number[], photoPaths: string[], itemId?: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(depositId) || !levels.length) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) =>
    sb.rpc('confirm_deposit', {
      p_deposit: depositId,
      p_levels: levels.map((l) => Math.round(l)),
      p_photo_paths: photoPaths.slice(0, 10),
      // R-060: bar confirms against the shop's list
      p_item_id: isUuid(itemId) ? itemId : undefined,
    }),
  )
  if (res.ok) {
    touched(depositId)
    after(() => dispatchSoon())
  }
  return res
}

/** R-075: bar / owner receive a LINE request and confirm it in one step (one transaction). */
export async function receiveAndConfirm(depositId: string, levels: number[], photoPaths: string[], itemId?: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(depositId) || !levels.length || levels.length > 50) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) =>
    sb.rpc('receive_and_confirm', {
      p_deposit: depositId,
      p_levels: levels.map((l) => Math.round(l)),
      p_photo_paths: photoPaths.slice(0, 10),
      p_item_id: isUuid(itemId) ? itemId : undefined,
    }),
  )
  if (res.ok) {
    touched(depositId)
    after(() => dispatchSoon())
  }
  return res
}

export async function rejectDeposit(depositId: string, reason: string): Promise<ActionResult<{ id: string; status: string }>> {
  if (!isUuid(depositId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; status: string }>((sb) => sb.rpc('reject_deposit', { p_deposit: depositId, p_reason: cleanText(reason, 200) ?? '' }))
  if (res.ok) {
    touched(depositId)
    after(() => dispatchSoon())
  }
  return res
}

export async function requestWithdrawal(input: {
  depositId: string
  bottleIds: string[]
  type: 'in_store' | 'take_home'
  table?: string
  notes?: string
}): Promise<ActionResult<{ deposit_id: string; withdrawal_ids: string[] }>> {
  if (!isUuid(input.depositId) || !input.bottleIds.every(isUuid) || !['in_store', 'take_home'].includes(input.type)) {
    return { ok: false, error: 'invalid' }
  }
  const res = await callRpc<{ deposit_id: string; withdrawal_ids: string[] }>((sb) =>
    sb.rpc('request_withdrawal', {
      p_deposit: input.depositId,
      p_bottle_ids: input.bottleIds,
      p_type: input.type,
      p_table: cleanText(input.table, 20),
      p_notes: cleanText(input.notes, 500),
    }),
  )
  if (res.ok) {
    touched(input.depositId)
    after(() => dispatchSoon())
  }
  return res
}

export async function completeWithdrawals(withdrawalIds: string[], depositId: string, photoPath?: string, notes?: string): Promise<ActionResult<{ deposit_id: string; status: string }>> {
  if (!withdrawalIds.length || !withdrawalIds.every(isUuid)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ deposit_id: string; status: string }>((sb) =>
    sb.rpc('complete_withdrawals', { p_withdrawal_ids: withdrawalIds, p_photo_path: photoPath, p_notes: cleanText(notes, 500) }),
  )
  if (res.ok) {
    touched(depositId)
    after(() => dispatchSoon())
  }
  return res
}

export async function rejectWithdrawal(withdrawalIds: string[], depositId: string, reason: string): Promise<ActionResult<{ deposit_id: string; status: string }>> {
  if (!withdrawalIds.length || !withdrawalIds.every(isUuid)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ deposit_id: string; status: string }>((sb) =>
    sb.rpc('reject_withdrawal', { p_withdrawal_ids: withdrawalIds, p_reason: cleanText(reason, 200) ?? '' }),
  )
  if (res.ok) {
    touched(depositId)
    after(() => dispatchSoon())
  }
  return res
}

export async function extendDeposit(depositId: string, days: number): Promise<ActionResult<{ id: string; expires_at: string }>> {
  if (!isUuid(depositId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; expires_at: string }>((sb) => sb.rpc('extend_deposit', { p_deposit: depositId, p_days: Math.trunc(days) }))
  if (res.ok) {
    touched(depositId)
    after(() => dispatchSoon())
  }
  return res
}

export async function setVip(depositId: string, vip: boolean): Promise<ActionResult<{ id: string; is_vip: boolean }>> {
  if (!isUuid(depositId)) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; is_vip: boolean }>((sb) => sb.rpc('set_vip', { p_deposit: depositId, p_vip: vip }))
  if (res.ok) {
    touched(depositId)
    after(() => dispatchSoon())
  }
  return res
}

/** This deposit's customer: LINE expiry reminders on or off, for every deposit of theirs (R-044, bar / owner). */
export async function setCustomerReminders(depositId: string, enabled: boolean): Promise<ActionResult<{ customer_id: string; enabled: boolean }>> {
  if (!isUuid(depositId) || typeof enabled !== 'boolean') return { ok: false, error: 'invalid' }
  const res = await callRpc<{ customer_id: string; enabled: boolean }>((sb) => sb.rpc('set_customer_expiry_notices', { p_deposit: depositId, p_enabled: enabled }))
  if (res.ok) touched(depositId)
  return res
}

/** R-076: one disposal record (DSP-…) with its photos; the customer is not messaged. */
export async function disposeDeposits(depositIds: string[], reason: string | undefined, photoPaths: string[]): Promise<ActionResult<{ count: number; id: string; code: string; bottles: number }>> {
  if (!depositIds.length || !depositIds.every(isUuid) || !photoPaths.length) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ count: number; id: string; code: string; bottles: number }>((sb) =>
    sb.rpc('dispose_deposits', { p_deposit_ids: depositIds, p_reason: cleanText(reason, 200), p_photo_paths: photoPaths.slice(0, 10) }),
  )
  if (res.ok) {
    touched()
    after(() => dispatchSoon())
  }
  return res
}

/** R-060 · bar / owner add a liquor name the list is missing, to their branch — an existing name is reused. */
export async function addLiquorItem(branchId: string, name: string, category: string): Promise<ActionResult<{ id: string; name: string; category: string; existed: boolean }>> {
  const clean = cleanText(name, 120)
  if (!isUuid(branchId) || !clean) return { ok: false, error: 'invalid' }
  const res = await callRpc<{ id: string; name: string; category: string; existed: boolean }>((sb) =>
    sb.rpc('add_liquor_item', { p_branch: branchId, p_name: clean, p_category: category }),
  )
  if (res.ok) revalidatePath('/settings/items')
  return res
}
