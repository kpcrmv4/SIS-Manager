import { getTranslations } from 'next-intl/server'
import QRCode from 'qrcode'
import { Download, QrCode } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'

/** R-080 — the system's address and a QR that opens the sign-in page, to hand to new staff. */
export async function LoginLinkCard({ baseUrl }: { baseUrl: string }) {
  const t = await getTranslations('loginLink')
  const url = `${baseUrl}/login`
  const qr = await QRCode.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: 'M' })
  return (
    <section className="card-surface mb-4 flex flex-col gap-4 p-4 sm:flex-row sm:items-center" data-testid="login-link" data-url={url}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt={t('qrAlt')} className="mx-auto size-40 flex-none rounded-lg border border-line bg-white p-1 sm:mx-0" data-testid="login-link-qr" />
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          <QrCode className="size-4 text-muted-token" aria-hidden />
          {t('title')}
        </h2>
        <p className="mt-0.5 text-sm text-muted-token">{t('body')}</p>
        <p className="mt-2 break-all rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink tnum" data-testid="login-link-url">
          {url}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyButton text={url} label={t('copy')} done={t('copied')} testId="login-link-copy" />
          <a href={qr} download="sis-manager-login-qr.png" className="btn-ghost btn-sm" data-testid="login-link-download">
            <Download className="size-4" aria-hidden />
            {t('download')}
          </a>
        </div>
      </div>
    </section>
  )
}
