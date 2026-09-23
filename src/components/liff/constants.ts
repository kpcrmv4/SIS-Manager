/**
 * The deposit terms text version (P2-C2). Shared by the deposit-request form (sends it) and
 * the API route (stamps it on the RPC call — the server never trusts a client-supplied
 * version). Bump this whenever `terms.item1..6` in messages/customer/*.json changes wording.
 */
export const TERMS_VERSION = '2026-09-23'
