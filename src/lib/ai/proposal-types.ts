/**
 * R-071: what the assistant prepares and the person confirms. The server resolves codes to ids
 * when it builds the card; the browser then calls the app's ordinary server action with these
 * arguments — the same call the page's own button makes, under the same role checks.
 */
export type ProposalCall =
  | { fn: 'requestWithdrawal'; args: { depositId: string; bottleIds: string[]; type: 'in_store' | 'take_home'; table: string } }
  | { fn: 'completeWithdrawals'; args: { withdrawalIds: string[]; depositId: string } }
  | { fn: 'rejectWithdrawal'; args: { withdrawalIds: string[]; depositId: string; reason: string } }
  | { fn: 'extendDeposit'; args: { depositId: string; days: number } }
  | { fn: 'setVip'; args: { depositId: string; vip: boolean } }
  | { fn: 'rejectDeposit'; args: { depositId: string; reason: string } }
  | { fn: 'createStaffBooking'; args: { branchId: string; night: string; slot: string; party: number; name: string; phone?: string; zoneId?: string; tableId?: string; note?: string } }
  | { fn: 'confirmBooking'; args: { bookingId: string; tableId?: string } }
  | { fn: 'rejectBooking'; args: { bookingId: string; reason: string } }
  | { fn: 'cancelBooking'; args: { bookingId: string; reason?: string } }
  | { fn: 'checkInBooking'; args: { branchId: string; ref: string } }
  | { fn: 'openDepositForm'; args: { href: string } }

export type ProposalKind =
  | 'withdraw'
  | 'completeWithdrawal'
  | 'rejectWithdrawal'
  | 'extend'
  | 'vip'
  | 'rejectDeposit'
  | 'book'
  | 'confirmBooking'
  | 'rejectBooking'
  | 'cancelBooking'
  | 'checkIn'
  | 'depositForm'

/** One line on the card; `tr` values are catalog keys under ai.value */
export type ProposalField = { key: string; value: string; tr?: boolean }

export type Proposal = { id: string; kind: ProposalKind; fields: ProposalField[]; call: ProposalCall; link?: string }

export type ProposalState = 'pending' | 'running' | 'done' | 'cancelled' | 'failed'
