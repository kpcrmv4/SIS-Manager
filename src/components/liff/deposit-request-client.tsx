'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { CustomerLocale } from '@/lib/i18n/config'
import { Minus, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { errorText } from './error-text'
import { TERMS_VERSION } from './constants'
import { customerFetch, useCxSession } from './session-context'
import { CxErrorRetry, CxLoader } from './cx-states'
import { blockedDaysText } from './weekday-names'

type Policy = { depositDays: number; blockedDays: string[] }
type Row = { key: number; item: string; quantity: number }
const MAX_ITEMS = 10

/** "ฝากเหล้า" (P2-C2): form + the 6-item terms, then customer_request_deposit. */
export function DepositRequestClient() {
  const t = useTranslations('cx')
  // the language on screen: the terms the customer reads and accepts, the weekday names
  const locale = useLocale() as CustomerLocale
  const router = useRouter()
  const session = useCxSession()

  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [policy, setPolicy] = useState<Policy | null>(null)

  const load = useCallback(() => {
    setState('loading')
    customerFetch(`/api/customer/deposits?branch=${session.branch.code}`, session)
      .then((res) => {
        if (!res.ok) throw new Error('load failed')
        return res.json() as Promise<{ branch: Policy }>
      })
      .then((d) => {
        setPolicy(d.branch)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [session])

  useEffect(() => {
    // Fetch-on-mount: load() sets 'loading' synchronously, which is the point (an immediate
    // skeleton, not one frame of stale content) — not the effect subscribing to an external store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  // R-065: filled with what this customer last gave; theirs to change
  const [name, setName] = useState(session.contact?.name ?? '')
  const [phone, setPhone] = useState(session.contact?.phone ?? '')
  // R-068: several liquors in one request — each becomes its own deposit
  const [rows, setRows] = useState<Row[]>([{ key: 0, item: '', quantity: 1 }])
  const [nextKey, setNextKey] = useState(1)
  const setRow = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const [table, setTable] = useState('')
  const [notes, setNotes] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [termsError, setTermsError] = useState(false)
  const [pending, setPending] = useState(false)

  if (state === 'loading') return <CxLoader label={t('shell.loading')} />
  if (state === 'error' || !policy) return <CxErrorRetry message={t('shell.errorGeneric')} onRetry={load} />

  const submit = async () => {
    const cleanName = name.trim()
    setNameError(!cleanName)
    setTermsError(!accepted)
    const filled = rows.filter((r) => r.item.trim())
    if (!cleanName || filled.length === 0 || !accepted) return

    setPending(true)
    try {
      const res = await customerFetch(`/api/customer/deposit-requests?branch=${session.branch.code}`, session, {
        method: 'POST',
        body: JSON.stringify({
          name: cleanName,
          phone: phone.trim() || undefined,
          items: filled.map((r) => ({ item_name: r.item.trim(), quantity: r.quantity })),
          table: table.trim() || undefined,
          notes: notes.trim() || undefined,
          accepted,
          terms_version: TERMS_VERSION,
          locale,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (body.error === 'name_required') setNameError(true)
        else if (body.error === 'terms_required' || body.error === 'TERMS_REQUIRED') setTermsError(true)
        else toast.error(errorText(t, body.error))
        return
      }
      toast.success(filled.length > 1 ? t('depositRequest.sentMany', { count: filled.length }) : t('depositRequest.sent'))
      router.push(`/liff/${session.branch.code.toLowerCase()}`)
    } catch {
      toast.error(t('shell.errorGeneric'))
    } finally {
      setPending(false)
    }
  }

  const blocked = blockedDaysText(policy.blockedDays, locale)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-cx-muted">{t('depositRequest.body')}</p>

      <label className="block">
        <span className="cx-label">{t('depositRequest.name')}</span>
        <input className="cx-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="cx-deposit-name" />
        {nameError && <p className="mt-1 text-xs text-cx-warn">{errorText(t, 'name_required')}</p>}
      </label>

      <label className="block">
        <span className="cx-label">{t('depositRequest.phone')}</span>
        <input className="cx-input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" data-testid="cx-deposit-phone" />
      </label>

      <div className="flex flex-col gap-2" data-testid="cx-deposit-items">
        {rows.map((r, i) => (
          <div key={r.key} className={rows.length > 1 ? 'cx-card gap-2' : 'flex flex-col gap-3'} data-testid="cx-deposit-item-row">
            {rows.length > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-cx-muted">{t('depositRequest.itemN', { n: i + 1 })}</span>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-full text-cx-muted"
                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                  aria-label={t('depositRequest.removeItem', { n: i + 1 })}
                  data-testid={`cx-deposit-remove-${i}`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            )}
            <label className="block">
              <span className="cx-label">{t('depositRequest.item')}</span>
              <input
                className="cx-input"
                value={r.item}
                onChange={(e) => setRow(r.key, { item: e.target.value })}
                placeholder={t('depositRequest.itemPlaceholder')}
                maxLength={120}
                data-testid={i === 0 ? 'cx-deposit-item' : `cx-deposit-item-${i}`}
              />
            </label>
            <div>
              <span className="cx-label">{t('depositRequest.quantity')}</span>
              <div className="cx-stepper" data-testid={i === 0 ? 'cx-deposit-qty' : `cx-deposit-qty-${i}`}>
                <button type="button" onClick={() => setRow(r.key, { quantity: Math.max(1, r.quantity - 1) })} aria-label="-">
                  <Minus className="size-4" aria-hidden />
                </button>
                <b className="num">{r.quantity}</b>
                <button type="button" onClick={() => setRow(r.key, { quantity: Math.min(50, r.quantity + 1) })} aria-label="+">
                  <Plus className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        ))}
        {rows.length < MAX_ITEMS && (
          <button
            type="button"
            className="cx-btn add"
            onClick={() => {
              setRows((prev) => [...prev, { key: nextKey, item: '', quantity: 1 }])
              setNextKey((k) => k + 1)
            }}
            data-testid="cx-deposit-add-item"
          >
            <Plus className="size-4" aria-hidden />
            {t('depositRequest.addItem')}
          </button>
        )}
        {rows.length > 1 && <p className="text-xs text-cx-muted">{t('depositRequest.itemsHelp')}</p>}
      </div>

      <label className="block">
        <span className="cx-label">{t('depositRequest.table')}</span>
        <input className="cx-input" value={table} onChange={(e) => setTable(e.target.value)} maxLength={20} />
      </label>

      <label className="block">
        <span className="cx-label">{t('depositRequest.notes')}</span>
        <input className="cx-input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
      </label>

      <div className="cx-card">
        <p className="cx-serif text-[15px] font-semibold">{t('terms.title')}</p>
        <ol className="flex list-decimal flex-col gap-2 pl-4 text-xs text-cx-muted">
          <li>{t('terms.item1', { days: policy.depositDays })}</li>
          <li>{t('terms.item2', { blocked })}</li>
          <li>{t('terms.item3')}</li>
          <li>{t('terms.item4')}</li>
          <li>{t('terms.item5')}</li>
          <li>{t('terms.item6')}</li>
        </ol>
        <label className="mt-2 flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="cx-terms-accept" />
          {t('terms.accept')}
        </label>
        {termsError && (
          <p className="text-xs text-cx-warn" data-testid="cx-terms-error">
            {t('terms.error')}
          </p>
        )}
      </div>

      <button type="button" className="cx-btn" disabled={pending} onClick={() => void submit()} data-testid="cx-deposit-submit">
        {t('depositRequest.submit')}
      </button>
    </div>
  )
}
