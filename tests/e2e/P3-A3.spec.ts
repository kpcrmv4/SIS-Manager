import { expect, test } from '@playwright/test'
import { adminDb } from './fixtures/db'
import { cleanupRun, confirmAll, deposit, mustCreate } from './fixtures/deposits'
import { LIFF_ID, MockLine, RUN, SECRET, SECRET_B, cleanupLine, configureBranches, lineEvent, lineUserId, postWebhook, textEvent } from './fixtures/p3a-line'
import cxTh from '../../messages/customer/th.json'
import cxEn from '../../messages/customer/en.json'
import { BRANCH_A_CODE } from './fixtures/users'

/** this fixture's branch A code — the webhook path segment (lower case) */
const A_CODE = BRANCH_A_CODE.toLowerCase()

const mock = new MockLine()
const lineIds: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await mock.start()
  await configureBranches()
})

test.afterAll(async () => {
  await mock.stop()
  await cleanupRun()
  await cleanupLine(lineIds)
})

function user() {
  const id = lineUserId()
  lineIds.push(id)
  return { type: 'user' as const, userId: id }
}

async function customerByLine(line: string) {
  const { data, error } = await adminDb().from('customers').select('id, display_name, locale').eq('line_user_id', line).maybeSingle()
  expect(error, error?.message).toBeNull()
  return data
}

async function linkedEvents(depositId: string) {
  const { count } = await adminDb().from('deposit_events').select('id', { count: 'exact', head: true }).eq('deposit_id', depositId).eq('action', 'line_linked')
  return count ?? 0
}

/** the one reply LINE got for a reply token: its first message */
function replyOf(replyToken: string) {
  const r = mock.repliesTo(replyToken)
  expect(r, 'exactly one reply').toHaveLength(1)
  return (r[0].body!.messages as { type: string; text?: string; altText?: string; contents?: unknown }[])[0]
}

async function inStoreDeposit() {
  const d = await mustCreate('staff', { qty: 2 })
  await confirmAll(d.id, [100, 50])
  return deposit(d.id)
}

test('P3-A3-01 missing / wrong x-line-signature → 401, nothing written', async ({ request }) => {
  const src = user()
  const body = { destination: 'x', events: [lineEvent(src, { type: 'follow' })] }
  expect((await postWebhook(request, A_CODE, body, null)).status()).toBe(401)
  expect((await postWebhook(request, A_CODE, body, 'f'.repeat(32))).status()).toBe(401)
  // a signature over different bytes than the body sent
  const res = await request.post(`/api/line/webhook/${A_CODE}`, {
    data: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-line-signature': 'AAAA' },
  })
  expect(res.status()).toBe(401)
  expect(await customerByLine(src.userId)).toBeNull()
  expect(mock.requests.filter((r) => r.path.includes(src.userId))).toHaveLength(0)
})

test('P3-A3-02 branch A body signed with branch B secret → 401; unknown branch code → 404', async ({ request }) => {
  const src = user()
  const body = { destination: 'x', events: [lineEvent(src, { type: 'follow' })] }
  expect((await postWebhook(request, A_CODE, body, SECRET_B)).status()).toBe(401)
  expect((await postWebhook(request, 'zqq', body, SECRET)).status()).toBe(404)
  expect((await postWebhook(request, 'not-a-code', body, SECRET)).status()).toBe(404)
  expect(await customerByLine(src.userId)).toBeNull()
  // the same body with the right secret, branch code in any case → accepted
  const mixedCase = A_CODE.charAt(0).toUpperCase() + A_CODE.slice(1)
  expect((await postWebhook(request, mixedCase, { destination: 'x', events: [] }, SECRET)).status()).toBe(200)
})

test('P3-A3-03 the receipt link code (any case, spaces) links the deposit and replies in the customer locale', async ({ request }) => {
  const src = user()
  // an existing English-speaking customer
  const { error } = await adminDb().from('customers').insert({ line_user_id: src.userId, display_name: `${RUN} en`, locale: 'en' })
  expect(error, error?.message).toBeNull()
  const d = await inStoreDeposit()
  const typed = ` ${d.link_code.slice(0, 3).toLowerCase()} ${d.link_code.slice(3)} `
  const ev = textEvent(src, typed)
  expect((await postWebhook(request, A_CODE, { destination: 'x', events: [ev] }, SECRET)).status()).toBe(200)
  const c = await customerByLine(src.userId)
  expect((await deposit(d.id)).customer_id).toBe(c!.id)
  expect(await linkedEvents(d.id)).toBe(1)
  const msg = replyOf(ev.replyToken)
  expect(msg.type).toBe('flex')
  expect(msg.altText).toContain(cxEn.line.titles.linked)
  expect(JSON.stringify(msg)).toContain(d.item_name)
  expect(JSON.stringify(msg)).toContain(`https://liff.line.me/${LIFF_ID}`)
})

test('P3-A3-04 the DEP code from the bottle tag does not link; reply says use the receipt code', async ({ request }) => {
  const src = user()
  const d = await inStoreDeposit()
  const ev = textEvent(src, d.code.toLowerCase())
  await postWebhook(request, A_CODE, { destination: 'x', events: [ev] }, SECRET)
  expect(replyOf(ev.replyToken)).toEqual({ type: 'text', text: cxTh.line.useReceiptCode })
  expect((await deposit(d.id)).customer_id).toBeNull()
  expect(await linkedEvents(d.id)).toBe(0)
})

test('P3-A3-05 a code already linked to another customer → the same generic not-found reply', async ({ request }) => {
  const owner = user()
  const d = await inStoreDeposit()
  const first = textEvent(owner, d.link_code)
  await postWebhook(request, A_CODE, { destination: 'x', events: [first] }, SECRET)
  const ownerRow = await customerByLine(owner.userId)
  expect((await deposit(d.id)).customer_id).toBe(ownerRow!.id)

  const thief = user()
  const steal = textEvent(thief, d.link_code)
  const missing = textEvent(thief, 'ZZZZ22')
  await postWebhook(request, A_CODE, { destination: 'x', events: [steal] }, SECRET)
  await postWebhook(request, A_CODE, { destination: 'x', events: [missing] }, SECRET)
  const a = replyOf(steal.replyToken)
  const b = replyOf(missing.replyToken)
  expect(a).toEqual({ type: 'text', text: cxTh.line.linkNotFound })
  expect(b).toEqual(a)
  expect((await deposit(d.id)).customer_id).toBe(ownerRow!.id)
  expect(await linkedEvents(d.id)).toBe(1)
})

test('P3-A3-06 five wrong codes, then the right one → "try again later", deposit stays unlinked', async ({ request }) => {
  const src = user()
  const d = await inStoreDeposit()
  for (const wrong of ['ZZZZ23', 'ZZZZ24', 'ZZZZ25', 'ZZZZ26', 'ZZZZ27']) {
    const ev = textEvent(src, wrong)
    await postWebhook(request, A_CODE, { destination: 'x', events: [ev] }, SECRET)
    expect(replyOf(ev.replyToken)).toEqual({ type: 'text', text: cxTh.line.linkNotFound })
  }
  const right = textEvent(src, d.link_code)
  await postWebhook(request, A_CODE, { destination: 'x', events: [right] }, SECRET)
  expect(replyOf(right.replyToken)).toEqual({ type: 'text', text: cxTh.line.throttled })
  expect((await deposit(d.id)).customer_id).toBeNull()
})

test('P3-A3-07 follow → customer upserted with the LINE display name; welcome reply with the LIFF link', async ({ request }) => {
  const src = user()
  const ev = lineEvent(src, { type: 'follow', follow: { isUnblocked: false } })
  expect((await postWebhook(request, A_CODE, { destination: 'x', events: [ev] }, SECRET)).status()).toBe(200)
  const c = await customerByLine(src.userId)
  expect(c).toMatchObject({ display_name: `${RUN} LINE ${src.userId.slice(-4)}`, locale: 'th' })
  const msg = replyOf(ev.replyToken)
  expect(msg.type).toBe('flex')
  expect(msg.altText).toContain(cxTh.line.titles.welcome)
  expect(JSON.stringify(msg)).toContain(`https://liff.line.me/${LIFF_ID}`)
  // following again (unblock) keeps one row
  const again = lineEvent(src, { type: 'follow', follow: { isUnblocked: true } })
  await postWebhook(request, A_CODE, { destination: 'x', events: [again] }, SECRET)
  const { count } = await adminDb().from('customers').select('id', { count: 'exact', head: true }).eq('line_user_id', src.userId)
  expect(count).toBe(1)
})

test('P3-A3-08 the same webhook event delivered twice (redelivery) is processed once', async ({ request }) => {
  const src = user()
  const d = await inStoreDeposit()
  const ev = textEvent(src, d.link_code)
  const body = { destination: 'x', events: [ev] }
  expect((await postWebhook(request, A_CODE, body, SECRET)).status()).toBe(200)
  const redelivered = { destination: 'x', events: [{ ...ev, deliveryContext: { isRedelivery: true } }] }
  expect((await postWebhook(request, A_CODE, redelivered, SECRET)).status()).toBe(200)
  expect(mock.repliesTo(ev.replyToken)).toHaveLength(1)
  expect(await linkedEvents(d.id)).toBe(1)
  const { count } = await adminDb().from('customers').select('id', { count: 'exact', head: true }).eq('line_user_id', src.userId)
  expect(count).toBe(1)
})
