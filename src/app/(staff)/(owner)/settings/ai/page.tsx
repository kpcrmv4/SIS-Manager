import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { AiSettings } from '@/components/settings/ai-settings'
import { getAiConfig } from '@/lib/ai/config'
import { aiUsageMonth } from '@/lib/ai/settings-actions'

/** R-070 — the owner gate is the (owner) layout. The key is read on the server only as "set / not set". */
export default async function SettingsAiPage() {
  const t = await getTranslations('settingsAi')
  const [config, usage] = await Promise.all([getAiConfig(), aiUsageMonth()])
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AiSettings initial={config} usage={usage.ok ? usage.data : null} />
    </>
  )
}
