import { LinkClient } from '@/components/liff/link-client'

// R-058 · the staff's one-time QR lands here: /liff/<branch>/link?t=<token>
export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const { t } = await searchParams
  return <LinkClient token={typeof t === 'string' ? t : ''} />
}
