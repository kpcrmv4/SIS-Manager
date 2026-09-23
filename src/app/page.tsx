import { getTranslations } from 'next-intl/server'

// Replaced in P0-05 by the role-aware landing redirect.
export default async function Home() {
  const t = await getTranslations('common')
  return <main className="p-8">{t('appName')}</main>
}
