import 'server-only'
import { getSupabaseServer } from '@/lib/supabase/server'
import { depositTabCounts } from '@/lib/deposit/list'
import { nightBookings } from '@/lib/booking/queries'
import { businessNight } from '@/lib/date'
import { isBarOrOwner, type Role } from '@/lib/auth/actor'

/**
 * R-070: what the assistant knows about the page the person has open, and the quick
 * questions that fit that page and what is actually waiting right now.
 */
export type Chip = { key: string; values?: Record<string, string | number> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function cleanPath(raw: unknown): string {
  const p = typeof raw === 'string' ? raw.slice(0, 200) : '/'
  return p.startsWith('/') && !p.startsWith('//') ? p : '/'
}

function depositIdIn(path: string): string | null {
  const m = /^\/deposits\/([0-9a-f-]{36})$/i.exec(path.split('?')[0])
  return m && UUID.test(m[1]) ? m[1] : null
}

async function depositOnPage(branchId: string, path: string) {
  const id = depositIdIn(path)
  if (!id) return null
  const sb = await getSupabaseServer()
  const { data } = await sb.from('deposits').select('code, status, item_name, customer_name, remaining_qty, quantity').eq('branch_id', branchId).eq('id', id).maybeSingle()
  return data
}

/** One line about the record on screen, for the model's context. */
export async function pageExtra(branchId: string, path: string): Promise<string | null> {
  const d = await depositOnPage(branchId, path)
  if (d) return `deposit ${d.code} · ${d.item_name} · ${d.customer_name} · status ${d.status} · ${d.remaining_qty}/${d.quantity} bottles left`
  const night = /[?&]night=(\d{4}-\d{2}-\d{2})/.exec(path)?.[1]
  if (path.startsWith('/bookings')) return `bookings of the night ${night ?? businessNight()}`
  return null
}

/** The branch's live numbers — read once per panel request and shared by the welcome and the chips. */
export type Snapshot = { counts: Awaited<ReturnType<typeof depositTabCounts>>; pendingBookings: number; liveBookings: number }

export async function snapshot(branchId: string): Promise<Snapshot> {
  const [counts, { bookings }] = await Promise.all([depositTabCounts(branchId), nightBookings(branchId, businessNight())])
  return {
    counts,
    pendingBookings: bookings.filter((b) => b.status === 'pending').length,
    liveBookings: bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed' || b.status === 'arrived').length,
  }
}

/** R-072: what is waiting in the branch right now, for the welcome — each row asks about itself. */
export function waitingFrom(s: Snapshot, role: Role): Chip[] {
  const barOwner = isBarOrOwner(role)
  const out: Chip[] = []
  if (s.counts.withdraw) out.push({ key: 'withdrawWaiting', values: { count: s.counts.withdraw } })
  if (barOwner && s.counts.toConfirm) out.push({ key: 'confirmWaiting', values: { count: s.counts.toConfirm } })
  if (s.counts.requests) out.push({ key: 'lineRequests', values: { count: s.counts.requests } })
  if (barOwner && s.counts.expired) out.push({ key: 'expiredWaiting', values: { count: s.counts.expired } })
  if (s.pendingBookings) out.push({ key: 'bookingsPending', values: { count: s.pendingBookings } })
  out.push({ key: 'tonightBookings', values: { count: s.liveBookings } })
  return out
}

export async function chipsFor(branchId: string, role: Role, path: string, snap?: Snapshot): Promise<Chip[]> {
  const base = path.split('?')[0]
  const barOwner = isBarOrOwner(role)
  const out: Chip[] = []
  const add = (c: Chip) => {
    if (out.length < 4 && !out.some((x) => x.key === c.key)) out.push(c)
  }

  const d = await depositOnPage(branchId, path)
  if (d) {
    if (d.status === 'pending_withdrawal') add({ key: barOwner ? 'doCompleteWithdrawal' : 'nextWithdrawal', values: { code: d.code } })
    if (d.status === 'pending_confirm') add({ key: barOwner ? 'nextConfirm' : 'nextConfirmStaff', values: { code: d.code } })
    if (d.status === 'requested') add({ key: 'nextRequested', values: { code: d.code } })
    if (d.status === 'expired') add({ key: barOwner ? 'howDispose' : 'expiredStaff' })
    add({ key: 'summarizeDeposit', values: { code: d.code } })
    if (d.status === 'in_store') add({ key: 'doWithdraw', values: { code: d.code } })
    if (barOwner && (d.status === 'in_store' || d.status === 'pending_withdrawal')) add({ key: 'howExtend' })
    add({ key: 'withdrawFlow' })
    return out
  }

  if (base === '/tonight' || base === '/overview' || base === '/deposits' || base === '/bookings' || base === '/') {
    const { counts, pendingBookings, liveBookings: live } = snap ?? (await snapshot(branchId))
    if (base === '/bookings') {
      add({ key: 'tonightBookings', values: { count: live } })
      if (pendingBookings) add({ key: 'bookingsPending', values: { count: pendingBookings } })
      add({ key: 'freeTables' })
      add({ key: 'doBook' })
      add({ key: 'howCheckin' })
      return out
    }
    if (base === '/deposits') {
      if (counts.withdraw) add({ key: 'withdrawWaiting', values: { count: counts.withdraw } })
      if (barOwner && counts.toConfirm) add({ key: 'confirmWaiting', values: { count: counts.toConfirm } })
      if (barOwner && counts.expired) add({ key: 'expiredWaiting', values: { count: counts.expired } })
      if (counts.requests) add({ key: 'lineRequests', values: { count: counts.requests } })
      add({ key: 'withdrawFlow' })
      add({ key: 'howDeposit' })
      return out
    }
    add({ key: 'summaryTonight' })
    if (counts.withdraw) add({ key: 'withdrawWaiting', values: { count: counts.withdraw } })
    if (barOwner && counts.toConfirm) add({ key: 'confirmWaiting', values: { count: counts.toConfirm } })
    if (pendingBookings) add({ key: 'bookingsPending', values: { count: pendingBookings } })
    if (counts.requests) add({ key: 'lineRequests', values: { count: counts.requests } })
    add({ key: 'tonightBookings', values: { count: live } })
    add({ key: 'withdrawFlow' })
    return out
  }

  if (base === '/deposits/new') {
    add({ key: 'howDeposit' })
    add({ key: 'multiItems' })
    add({ key: 'phoneOwner' })
    add({ key: 'photoWhy' })
    return out
  }
  if (base === '/scan') {
    add({ key: 'howScan' })
    add({ key: 'howCheckin' })
    add({ key: 'withdrawFlow' })
    return out
  }
  if (base.startsWith('/settings') || base === '/reports' || base === '/audit' || base === '/customers' || base.startsWith('/deposits/history')) {
    add({ key: 'thisPage' })
    add({ key: 'withdrawFlow' })
    add({ key: 'summaryTonight' })
    return out
  }
  add({ key: 'thisPage' })
  add({ key: 'summaryTonight' })
  add({ key: 'withdrawFlow' })
  add({ key: 'howDeposit' })
  return out
}
