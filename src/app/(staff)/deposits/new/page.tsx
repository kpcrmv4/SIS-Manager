import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { NewDepositForm, type DepositPrefill } from '@/components/deposit/new-deposit-form'
import { getActorState } from '@/lib/auth/actor'
import { getBranchSettings } from '@/lib/deposit/branch'
import { listLiquorItems } from '@/lib/deposit/items'

/** R-071: the assistant opens this form filled in — ?name=&phone=&table=&items=Name*2|Other*1 */
function prefillFrom(sp: Record<string, string | string[] | undefined>): DepositPrefill | null {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).slice(0, 400) : '')
  const items = one('items')
    .split('|')
    .map((p) => {
      const i = p.lastIndexOf('*')
      const name = (i > 0 ? p.slice(0, i) : p).trim().slice(0, 120)
      const qty = i > 0 ? Number(p.slice(i + 1)) : 1
      return { name, qty: Number.isInteger(qty) && qty >= 1 && qty <= 50 ? qty : 1 }
    })
    .filter((x) => x.name)
    .slice(0, 10)
  const name = one('name').trim().slice(0, 120)
  if (!name && !items.length) return null
  return { name, phone: one('phone').trim().slice(0, 20), table: one('table').trim().slice(0, 20), items }
}

export default async function NewDepositPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const prefill = prefillFrom(await searchParams)
  const t = await getTranslations('depositForm')
  const state = await getActorState()

  const actor = state.status === 'ok' ? state.actor : null
  const branch = actor?.branch ?? null

  if (!actor || !branch) {
    const tn = await getTranslations('nav')
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState message={tn('switchBranch')} />
      </>
    )
  }

  const [settings, items] = await Promise.all([getBranchSettings(branch.id), listLiquorItems(branch.id)])

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <NewDepositForm key={prefill ? JSON.stringify(prefill) : 'blank'} prefill={prefill} branchId={branch.id} items={items} depositDays={settings?.depositDays ?? 30} role={actor.role} locale={actor.locale} />
    </>
  )
}
