'use client'

import { useRef, useState, useSyncExternalStore, useTransition } from 'react'

const noopSubscribe = () => () => {}
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { PhotoPicker } from './photo-picker'
import { PhoneOwnerCard, usePhoneOwner, type PhoneChoice } from './phone-owner-check'
import { createDeposits, type CreatedDeposit } from '@/lib/deposit/actions'
import { NewDepositSaved } from './new-deposit-saved'
import { addDays, bangkokDate, formatShortDate } from '@/lib/date'
import type { LiquorItem } from '@/lib/deposit/items'

type Row = { key: number; name: string; qty: number }
export type DepositPrefill = { name: string; phone: string; table: string; items: { name: string; qty: number }[] }
const MAX_ITEMS = 10

export function NewDepositForm({
  prefill = null,
  branchId,
  items,
  depositDays,
  role,
  locale,
}: {
  /** R-071: filled in by the assistant; the person checks it, adds the photo and saves */
  prefill?: DepositPrefill | null
  branchId: string
  items: LiquorItem[]
  depositDays: number
  role: 'staff' | 'bar' | 'owner'
  locale: 'th' | 'en'
}) {
  const t = useTranslations('depositForm')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const router = useRouter()
  const barOrOwner = role !== 'staff'
  const defaultExpiry = addDays(bangkokDate(), depositDays)

  const [name, setName] = useState(prefill?.name ?? '')
  const [phone, setPhone] = useState(prefill?.phone ?? '')
  // R-068: several liquors in one form — each row becomes its own deposit and DEP code
  const [rows, setRows] = useState<Row[]>(() => (prefill?.items.length ? prefill.items.map((it, i) => ({ key: i, name: it.name, qty: it.qty })) : [{ key: 0, name: '', qty: 1 }]))
  const [saved, setSaved] = useState<CreatedDeposit[] | null>(null)
  const nextKey = useRef(Math.max(1, prefill?.items.length ?? 0))
  const [table, setTable] = useState(prefill?.table ?? '')
  const [expiresDate, setExpiresDate] = useState(defaultExpiry)
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  // typing before hydration is overwritten by React's first render — tests wait for this flag
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const [pending, start] = useTransition()
  // R-059: a phone that is a LINE customer's asks "ใช่คนนี้ไหม" before the deposit can be saved
  const phoneRef = useRef<HTMLInputElement>(null)
  const [phoneChoice, setPhoneChoice] = useState<PhoneChoice>(null)
  const { owner, checking, ensure } = usePhoneOwner(branchId, phone)

  function choosePhone(c: PhoneChoice) {
    setPhoneChoice(c)
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== 'phone')))
    if (c === 'owner' && !name.trim() && owner?.lastName) setName(owner.lastName)
    if (c === 'denied') phoneRef.current?.focus()
  }

  const setRow = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addRow = () => {
    setRows((prev) => (prev.length >= MAX_ITEMS ? prev : [...prev, { key: nextKey.current++, name: '', qty: 1 }]))
  }
  const removeRow = (key: number) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev))

  function startAnother() {
    setSaved(null)
    setRows([{ key: nextKey.current++, name: '', qty: 1 }])
    setName('')
    setPhone('')
    setPhoneChoice(null)
    setTable('')
    setNotes('')
    setPhotos([])
    setErrors({})
  }

  function submit() {
    const nextErrors: Record<string, string> = {}
    if (!name.trim()) nextErrors.name = t('nameRequired')
    rows.forEach((r) => {
      if (!r.name.trim()) nextErrors[`item_${r.key}`] = t('itemRequired')
      if (!Number.isFinite(r.qty) || r.qty < 1 || r.qty > 50) nextErrors[`qty_${r.key}`] = t('quantityInvalid')
    })
    if (!barOrOwner && photos.length === 0) nextErrors.photo = t('photoRequired')
    if (owner && phoneChoice === null) nextErrors.phone = t('ownerPick')
    if (owner && phoneChoice === 'denied') nextErrors.phone = t('ownerFix')
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    start(async () => {
      const o = await ensure()
      if (o && (phoneChoice === null || phoneChoice === 'denied')) {
        setErrors({ phone: phoneChoice === null ? t('ownerPick') : t('ownerFix') })
        return
      }
      const res = await createDeposits({
        branchId,
        customerName: name,
        customerPhone: phone || undefined,
        table: table || undefined,
        items: rows.map((r) => {
          const matched = items.find((i) => i.name === r.name.trim())
          return { itemId: matched?.id, itemName: r.name.trim(), category: matched?.category, quantity: r.qty }
        }),
        photoPaths: photos,
        notes: notes || undefined,
        expiresAt: barOrOwner ? `${expiresDate}T23:59:59+07:00` : undefined,
        phoneChoice: !o ? undefined : phoneChoice === 'owner' ? { kind: 'owner', customerId: o.customerId } : { kind: 'shared' },
      })
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      const made = res.data.deposits
      if (made.length === 1) {
        toast.success(t('created', { code: made[0].code }))
        router.push(`/deposits/${made[0].id}`)
        return
      }
      toast.success(t('createdMany', { count: made.length }))
      setSaved(made)
      window.scrollTo({ top: 0 })
    })
  }

  if (saved) return <NewDepositSaved branchId={branchId} deposits={saved} onAnother={startAnother} />

  return (
    <div className="card-surface max-w-160 p-4" data-testid="new-deposit-form" data-hydrated={hydrated}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-base" htmlFor="f-name">
              {t('customerName')}
            </label>
            <input id="f-name" className="input-base" value={name} onChange={(e) => setName(e.target.value)} data-testid="deposit-name" />
            {errors.name && <p className="help-text text-urgent">{errors.name}</p>}
          </div>
          <div>
            <label className="label-base" htmlFor="f-phone">
              {t('phone')}
            </label>
            <input
              id="f-phone"
              ref={phoneRef}
              className="input-base tnum"
              inputMode="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                setPhoneChoice(null)
              }}
              data-testid="deposit-phone"
            />
            <PhoneOwnerCard owner={owner} checking={checking} choice={phoneChoice} onChoose={choosePhone} error={errors.phone} />
          </div>
        </div>

        <div data-testid="deposit-items">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="label-base mb-0">{t('item')}</span>
            {rows.length > 1 && <span className="text-xs text-muted-token">{t('itemsCount', { count: rows.length })}</span>}
          </div>
          <datalist id="deposit-items">
            {items.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={r.key} className={rows.length > 1 ? 'rounded-lg border border-line-soft p-2.5' : ''} data-testid="deposit-item-row">
                {rows.length > 1 && (
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-token">{t('itemN', { n: i + 1 })}</span>
                    <button type="button" className="btn-ghost btn-sm -my-1" onClick={() => removeRow(r.key)} aria-label={t('removeItem', { n: i + 1 })} data-testid={`deposit-remove-item-${i}`}>
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <input
                      id={i === 0 ? 'f-item' : undefined}
                      className="input-base"
                      list="deposit-items"
                      placeholder={t('itemPlaceholder')}
                      aria-label={rows.length > 1 ? t('itemN', { n: i + 1 }) : t('item')}
                      value={r.name}
                      onChange={(e) => setRow(r.key, { name: e.target.value })}
                      data-testid={i === 0 ? 'deposit-item' : `deposit-item-${i}`}
                    />
                    {errors[`item_${r.key}`] && <p className="help-text text-urgent">{errors[`item_${r.key}`]}</p>}
                  </div>
                  <div className="w-24 flex-none">
                    <input
                      id={i === 0 ? 'f-qty' : undefined}
                      type="number"
                      min={1}
                      max={50}
                      inputMode="numeric"
                      className="input-base tnum"
                      aria-label={t('quantity')}
                      value={r.qty}
                      onChange={(e) => setRow(r.key, { qty: Number(e.target.value) })}
                      data-testid={i === 0 ? 'deposit-quantity' : `deposit-quantity-${i}`}
                    />
                    {errors[`qty_${r.key}`] && <p className="help-text text-urgent">{errors[`qty_${r.key}`]}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <p className="help-text m-0">{rows.length > 1 ? t('itemsHelp') : t('itemHelp')}</p>
            {rows.length < MAX_ITEMS && (
              <button type="button" className="btn-ghost btn-sm" onClick={addRow} data-testid="deposit-add-item">
                <Plus className="size-4" aria-hidden />
                {t('addItem')}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-base" htmlFor="f-table">
              {t('table')}
            </label>
            <input id="f-table" className="input-base" value={table} onChange={(e) => setTable(e.target.value)} data-testid="deposit-table" />
          </div>
          <div>
            <label className="label-base" htmlFor="f-exp">
              {t('expires')}
            </label>
            {barOrOwner ? (
              <input
                id="f-exp"
                type="date"
                className="input-base tnum"
                value={expiresDate}
                onChange={(e) => setExpiresDate(e.target.value)}
                data-testid="deposit-expires"
              />
            ) : (
              <input
                id="f-exp"
                className="input-base tnum"
                disabled
                value={t('expiresValue', { date: formatShortDate(defaultExpiry, locale), days: depositDays })}
                data-testid="deposit-expires"
              />
            )}
            <p className="help-text">{t('expiresHelp')}</p>
          </div>
        </div>

        <div>
          <label className="label-base">{t('photo')}</label>
          <PhotoPicker branchId={branchId} paths={photos} onChange={setPhotos} addLabel={t('photoAdd')} helpText={t('photoHelp')} testId="deposit-photo-add" />
          {errors.photo && (
            <p className="help-text text-urgent" data-testid="deposit-photo-error">
              {errors.photo}
            </p>
          )}
        </div>

        <div>
          <label className="label-base" htmlFor="f-notes">
            {t('notes')}
          </label>
          <textarea id="f-notes" className="input-base" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => router.push('/deposits')} disabled={pending}>
            {tc('cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending} data-testid="deposit-submit">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {rows.length > 1 ? t('submitMany', { count: rows.length }) : t('submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
