import { MyBottlesClient } from '@/components/liff/my-bottles-client'

// "ขวดของฉัน" (P2-C2) — the session/branch come from <LiffShell>'s context, not params here.
export default function Page() {
  return <MyBottlesClient />
}
