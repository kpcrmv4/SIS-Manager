import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import QRCode from 'qrcode'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/states'
import { CopyButton } from '@/components/ui/copy-button'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getBotInfo } from '@/lib/line/client'

/**
 * R-080 — QR เพิ่มเพื่อน LINE: every role can put the branch's OA QR on screen for a customer to scan
 * and add the shop as a friend. The OA id comes from LINE's bot info with the branch's channel token
 * (server only, free — not a message); the QR is drawn on the server.
 */
export default async function LineQrPage() {
  const t = await getTranslations('lineQr')
  const tn = await getTranslations('nav')
  const state = await getActorState()
  const actor = state.status === 'ok' ? state.actor : null
  const branch = actor?.branch ?? null
  if (!actor || !branch) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState message={tn('switchBranch')} />
      </>
    )
  }

  const { data: secret } = await getSupabaseAdmin().from('branch_line_secrets').select('channel_access_token').eq('branch_id', branch.id).maybeSingle()
  const info = secret?.channel_access_token ? await getBotInfo(secret.channel_access_token) : null
  if (!info) {
    return (
      <>
        <PageHeader title={t('title')} />
        <div data-testid="line-qr-missing">
          <EmptyState message={secret?.channel_access_token ? t('unreachable') : t('notSetUp')} />
          {actor.role === 'owner' && (
            <p className="mt-3 text-center">
              <Link href="/settings/line" className="btn-secondary inline-flex">
                {t('toSettings')}
              </Link>
            </p>
          )}
        </div>
      </>
    )
  }

  const url = `https://line.me/R/ti/p/${encodeURIComponent(info.premiumId ?? info.basicId)}`
  const qr = await QRCode.toDataURL(url, { margin: 2, width: 640, errorCorrectionLevel: 'M' })
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <section className="card-surface mx-auto flex max-w-md flex-col items-center gap-3 p-5 text-center" data-testid="line-qr" data-url={url}>
        <div className="flex items-center gap-2.5">
          {info.pictureUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.pictureUrl} alt="" className="size-10 rounded-full border border-line object-cover" />
          )}
          <div className="text-left">
            <p className="text-base font-bold text-ink">{info.displayName ?? branch.name}</p>
            <p className="text-sm text-muted-token tnum">{info.premiumId ?? info.basicId}</p>
          </div>
        </div>
        {/* white behind the code in dark mode too — a phone camera reads dark-on-light */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={t('qrAlt', { name: info.displayName ?? branch.name })} className="aspect-square w-full max-w-[320px] rounded-xl bg-white p-2" data-testid="line-qr-image" />
        <p className="text-[15px] font-semibold text-ink">{t('scan')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <CopyButton text={url} label={t('copy')} done={t('copied')} testId="line-qr-copy" />
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
            {t('open')}
          </a>
        </div>
      </section>
    </>
  )
}
