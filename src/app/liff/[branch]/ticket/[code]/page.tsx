import { TicketClient } from '@/components/liff/ticket-client'

// "บัตรจองของคุณ" (P2-C3)
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <TicketClient code={code} />
}
