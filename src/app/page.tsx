import { APP_NAME } from '@/lib/constants'

// Replaced in P0-05 by the role-aware landing redirect.
export default function Home() {
  return <main className="p-8">{APP_NAME}</main>
}
