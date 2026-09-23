/**
 * Web-push delivery, independent of transport (P4-03). `dispatch.ts` plugs in the real
 * web-push sender; the spec plugs in a recorder — so the claim → render → send →
 * prune-dead-subscription logic is proven without a real push service.
 */
export type PushRow = {
  notification_id: string
  user_id: string
  kind: string
  payload: Record<string, unknown> | null
  link: string | null
  subscription_id: string
  endpoint: string
  p256dh: string
  auth: string
}

export type PushMessage = { title: string; body: string; url: string; tag: string }
export type SendResult = { statusCode: number }

export async function deliver(
  rows: PushRow[],
  render: (row: PushRow) => PushMessage,
  send: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, message: PushMessage) => Promise<SendResult>,
  removeSubscription: (id: string) => Promise<void>,
): Promise<{ sent: number; removed: number; failed: number }> {
  let sent = 0
  let removed = 0
  let failed = 0
  for (const row of rows) {
    const message = render(row)
    try {
      const res = await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, message)
      if (res.statusCode >= 200 && res.statusCode < 300) sent++
      else failed++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // 404 / 410: the browser dropped this subscription — never try it again
      if (status === 404 || status === 410) {
        await removeSubscription(row.subscription_id)
        removed++
      } else {
        failed++
      }
    }
  }
  return { sent, removed, failed }
}
