import { getCustomerLocale } from '@/lib/i18n/customer'
import { LiffPlaceholder } from '@/components/liff/liff-placeholder'

// LIFF route skeleton (P1-05) - built in P2-C2.
export default async function Page() {
  const locale = await getCustomerLocale()
  return <LiffPlaceholder locale={locale} title="bottles.title" body="bottles.empty" />
}
