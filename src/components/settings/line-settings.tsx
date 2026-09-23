'use client'

import { useState, useSyncExternalStore, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Copy, KeyRound, Loader2, Send, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { formatTime } from '@/lib/date'
import { newGroupBindCode, saveLineSettings, sendLineTest, type LineField } from '@/lib/line/settings-actions'

type Initial = { liffId: string; channelId: string; botUserId: string }

const noopSubscribe = () => () => {}

/**
 * /settings/line (P3-A2-06..09). The secrets are write-only: the page gets two booleans,
 * never the values, and a blank secret field means "keep the current one".
 */
export function LineSettings({
  branchId,
  initial,
  hasToken,
  hasSecret,
  groupBound,
  webhookUrl,
  liffLink,
}: {
  branchId: string
  initial: Initial
  hasToken: boolean
  hasSecret: boolean
  groupBound: boolean
  webhookUrl: string
  liffLink: string | null
}) {
  const t = useTranslations('settingsLine')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [token, setToken] = useState('')
  const [secret, setSecret] = useState('')
  const [bind, setBind] = useState<{ code: string; expiresAt: string } | null>(null)
  const [saving, startSave] = useTransition()
  const [binding, startBind] = useTransition()
  const [testing, startTest] = useTransition()
  // L-005: specs wait for this before typing into the form
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)

  const labels: Record<LineField, string> = {
    liffId: t('liffId'),
    channelId: t('channelId'),
    botUserId: t('botUserId'),
    accessToken: t('accessToken'),
    channelSecret: t('channelSecret'),
  }

  function save() {
    startSave(async () => {
      const res = await saveLineSettings(branchId, { ...v, accessToken: token, channelSecret: secret })
      if (!res.ok) {
        if (res.error === 'invalid') toast.error(t('invalid', { field: labels[res.field] }))
        else toast.error(res.error === 'FORBIDDEN' ? te('FORBIDDEN') : tc('errorGeneric'))
        return
      }
      setToken('')
      setSecret('')
      toast.success(tc('saved'))
      router.refresh()
    })
  }

  function makeCode() {
    startBind(async () => {
      const res = await newGroupBindCode(branchId)
      if (!res.ok) {
        toast.error(res.error === 'FORBIDDEN' ? te('FORBIDDEN') : tc('errorGeneric'))
        return
      }
      setBind({ code: res.data.code, expiresAt: res.data.expires_at })
    })
  }

  function sendTest() {
    startTest(async () => {
      const res = await sendLineTest(branchId)
      if (!res.ok) {
        toast.error(res.error === 'NO_GROUP' || res.error === 'FORBIDDEN' ? te(res.error) : tc('errorGeneric'))
        return
      }
      toast.success(t('testSent'))
    })
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t('copied'))
    } catch {
      toast.error(tc('errorGeneric'))
    }
  }

  const field = (id: LineField, key: keyof Initial, help: string, placeholder?: string) => (
    <div>
      <label className="label-base" htmlFor={`line-${id}`}>
        {labels[id]}
      </label>
      <input
        id={`line-${id}`}
        className="input-base"
        value={v[key]}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))}
        maxLength={64}
      />
      <p className="help-text">{help}</p>
    </div>
  )

  const secretField = (id: 'accessToken' | 'channelSecret', value: string, set: (s: string) => void, isSet: boolean) => (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="label-base" htmlFor={`line-${id}`}>
          {labels[id]}
        </label>
        <span data-testid={`line-${id}-status`}>
          <Badge tone={isSet ? 'done' : 'pending'}>{isSet ? t('secretSet') : t('secretNotSet')}</Badge>
        </span>
      </div>
      <input
        id={`line-${id}`}
        type="password"
        className="input-base"
        value={value}
        autoComplete="new-password"
        spellCheck={false}
        onChange={(e) => set(e.target.value)}
        maxLength={600}
      />
      <p className="help-text">{t('secretHelp')}</p>
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="line-settings" data-hydrated={hydrated ? 'true' : 'false'}>
      <section className="card-surface flex flex-col gap-4 p-4 lg:row-span-2" aria-labelledby="line-channel">
        <h2 id="line-channel" className="sec-head">
          {t('channel')}
        </h2>
        {field('liffId', 'liffId', t('liffIdHelp'), '1234567890-AbCdEfGh')}
        {field('channelId', 'channelId', t('channelIdHelp'))}
        {field('botUserId', 'botUserId', t('botUserIdHelp'), '@abc123')}
        <h3 className="sec-head">{t('secrets')}</h3>
        {secretField('accessToken', token, setToken, hasToken)}
        {secretField('channelSecret', secret, setSecret, hasSecret)}
        <button type="button" className="btn-primary self-start" disabled={saving} onClick={save} data-testid="line-save">
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tc('save')}
        </button>
      </section>

      <section className="card-surface flex min-w-0 flex-col gap-3 p-4" aria-labelledby="line-webhook">
        <h2 id="line-webhook" className="sec-head">
          {t('webhookUrl')}
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-xs bg-surface-2 px-3 py-2 text-sm text-ink" data-testid="line-webhook-url">
            {webhookUrl}
          </code>
          <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => copy(webhookUrl)} aria-label={t('copy')}>
            <Copy className="size-4" aria-hidden />
          </button>
        </div>
        <p className="help-text">{t('webhookHelp')}</p>
        <div className="text-sm">
          <span className="text-muted-token">{t('liffUrl')}: </span>
          {liffLink ? (
            <a className="break-all text-brand underline" href={liffLink} target="_blank" rel="noreferrer">
              {liffLink}
            </a>
          ) : (
            <span className="text-muted-token">{t('notSet')}</span>
          )}
        </div>
      </section>

      <section className="card-surface flex flex-col gap-3 p-4" aria-labelledby="line-group">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="line-group" className="sec-head">
            {t('group')}
          </h2>
          <span data-testid="line-group-status">
            <Badge tone={groupBound ? 'done' : 'pending'}>{groupBound ? t('groupBound') : t('groupNotBound')}</Badge>
          </span>
        </div>
        {bind && (
          <div className="rounded-xs bg-surface-2 p-3" data-testid="line-bind-code">
            <p className="tnum text-2xl font-bold tracking-wider text-ink">{bind.code}</p>
            <p className="text-sm text-muted-token">{t('codeExpires', { time: formatTime(bind.expiresAt, 'th') })}</p>
            <p className="mt-2 text-sm text-ink">{t('codeSteps')}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={binding} onClick={makeCode} data-testid="line-make-code">
            {binding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
            {t('makeCode')}
          </button>
          <button type="button" className="btn-secondary" disabled={testing} onClick={sendTest} data-testid="line-test">
            {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : groupBound ? <Send className="size-4" aria-hidden /> : <Users className="size-4" aria-hidden />}
            {t('test')}
          </button>
        </div>
      </section>
    </div>
  )
}
