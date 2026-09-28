import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import { BackLink } from '@/components/shell/back-link'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseServer } from '@/lib/supabase/server'
import { signedPhotoUrls } from '@/lib/photos-server'
import { formatShortDate, formatTime } from '@/lib/date'

type Item = { bottles: number; deposit: { id: string; code: string; item_name: string; customer_name: string; table_label: string | null } | null }

/**
 * R-076 — one disposal: its number, who and when, the reason, the photos, and every deposit it
 * took off the shelf with its bottle count. Read through RLS: members of the branch only.
 */
export default async function DisposalPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params
  const code = decodeURIComponent(raw).toUpperCase().slice(0, 30)
  const t = await getTranslations('disposal')
  const state = await getActorState()
  const actor = state.status === 'ok' ? state.actor : null
  const branch = actor?.branch ?? null

  const sb = await getSupabaseServer()
  const { data: rec } = branch
    ? await sb
        .from('disposals')
        .select('id, code, reason, photo_paths, deposit_count, bottle_count, created_at, disposed_by')
        .eq('branch_id', branch.id)
        .eq('code', code)
        .maybeSingle()
    : { data: null }

  if (!actor || !rec) {
    return (
      <>
        <BackLink fallbackHref="/deposits/history" fallbackLabel={t('back')} />
        <PageHeader title={t('title', { code })} />
        <EmptyState message={t('notFound')} />
      </>
    )
  }

  const [{ data: itemRows }, urls, { data: by }] = await Promise.all([
    sb
      .from('disposal_items')
      .select('bottles, deposit:deposits(id, code, item_name, customer_name, table_label)')
      .eq('disposal_id', rec.id)
      .order('deposit_id')
      .range(0, 199),
    signedPhotoUrls(rec.photo_paths ?? []),
    // the person who disposed (profiles: colleagues sharing a branch are readable)
    rec.disposed_by ? sb.from('profiles').select('display_name, role').eq('id', rec.disposed_by).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const items = (itemRows ?? []) as unknown as Item[]
  const locale = actor.locale

  return (
    <div data-testid="disposal-page">
      <BackLink fallbackHref="/deposits/history" fallbackLabel={t('back')} />
      <PageHeader title={t('title', { code: rec.code })} subtitle={<span className="font-semibold text-urgent tnum" data-testid="disposal-total">{t('total', { bottles: rec.bottle_count, deposits: rec.deposit_count })}</span>} />
      <div className="grid items-start gap-4 nav:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <section className="card-surface p-4">
          <h2 className="sec-head">
            {t('items')}
            <span className="count">{items.length}</span>
          </h2>
          <ul className="divide-y divide-line-soft">
            {items.map((it) =>
              it.deposit ? (
                <li key={it.deposit.id}>
                  <Link href={`/deposits/${it.deposit.id}`} className="flex min-h-12 items-center gap-3 py-2.5" data-testid="disposal-item">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{it.deposit.item_name}</span>
                      <span className="block truncate text-xs text-muted-token">
                        <span className="code">{it.deposit.code}</span> · {it.deposit.customer_name}
                        {it.deposit.table_label ? ` · ${it.deposit.table_label}` : ''}
                      </span>
                    </span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink tnum">{t('bottles', { count: it.bottles })}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-token" aria-hidden />
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </section>

        <div className="flex flex-col gap-4">
          <section className="card-surface p-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-token">{t('by')}</dt>
              <dd className="font-medium text-ink">{by ? `${by.display_name} (${by.role})` : '—'}</dd>
              <dt className="text-muted-token">{t('at')}</dt>
              <dd className="font-medium text-ink tnum">
                {formatShortDate(rec.created_at, locale)} · {formatTime(rec.created_at, locale)}
              </dd>
              <dt className="text-muted-token">{t('count')}</dt>
              <dd className="font-medium text-ink tnum">{t('countValue', { deposits: rec.deposit_count, bottles: rec.bottle_count })}</dd>
              {rec.reason && (
                <>
                  <dt className="text-muted-token">{t('reason')}</dt>
                  <dd className="font-medium text-ink">{rec.reason}</dd>
                </>
              )}
            </dl>
          </section>
          {Object.keys(urls).length > 0 && (
            <section className="card-surface p-4">
              <h2 className="sec-head">{t('photos')}</h2>
              <div className="grid grid-cols-3 gap-2">
                {Object.values(urls).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-line bg-surface-2" data-testid="disposal-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="size-full object-cover" />
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
