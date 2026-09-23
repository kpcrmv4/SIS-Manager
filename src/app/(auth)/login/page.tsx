import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { demoLoginEnabled } from '@/lib/auth/demo'
import { safeNext } from '@/lib/auth/safe-next'
import { APP_NAME, SHOP_NAME } from '@/lib/constants'
import { LoginForm } from './login-form'

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const t = await getTranslations('login')
  const sp = await searchParams
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null)

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Image src="/logo.png" alt={SHOP_NAME} width={72} height={72} priority className="rounded-2xl" />
          <div>
            <h1 className="text-xl font-bold text-ink">{APP_NAME}</h1>
            <p className="text-sm text-muted-token">{t('subtitle')}</p>
          </div>
        </div>
        <div className="card-surface p-5 shadow-e1">
          <h2 className="mb-4 text-base font-semibold text-ink">{t('title')}</h2>
          {sp.reason === 'inactive' && (
            <p role="alert" className="mb-3 rounded-md bg-urgent-bg px-3 py-2 text-sm text-urgent">
              {t('inactive')}
            </p>
          )}
          <LoginForm next={next} demo={demoLoginEnabled()} />
        </div>
        <p className="mt-4 text-center text-xs text-muted-token">{t('noAccount')}</p>
      </div>
    </main>
  )
}
