'use client'

import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'

const noopSubscribe = () => () => {}
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PhotoPicker } from './photo-picker'
import { PhoneOwnerCard, usePhoneOwner, type PhoneChoice } from './phone-owner-check'
import { createDeposit } from '@/lib/deposit/actions'
import { addDays, bangkokDate, formatShortDate } from '@/lib/date'
import type { LiquorItem } from '@/lib/deposit/items'

export function NewDepositForm({
  branchId,
  items,
  depositDays,
  role,
  locale,
}: {
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

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [itemName, setItemName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [table, setTable] = useState('')
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

  const matchedItem = useMemo(() => items.find((i) => i.name === itemName), [items, itemName])

  function submit() {
    const nextErrors: Record<string, string> = {}
    if (!name.trim()) nextErrors.name = t('nameRequired')
    if (!itemName.trim()) nextErrors.item = t('itemRequired')
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) nextErrors.quantity = t('quantityInvalid')
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
      const res = await createDeposit({
        branchId,
        customerName: name,
        customerPhone: phone || undefined,
        table: table || undefined,
        itemId: matchedItem?.id,
        itemName,
        category: matchedItem?.category,
        quantity,
        photoPaths: photos,
        notes: notes || undefined,
        expiresAt: barOrOwner ? `${expiresDate}T23:59:59+07:00` : undefined,
        phoneChoice: !o ? undefined : phoneChoice === 'owner' ? { kind: 'owner', customerId: o.customerId } : { kind: 'shared' },
      })
      if (!res.ok) {
        toast.error(te(res.error))
        return
      }
      toast.success(t('created', { code: res.data?.code ?? '' }))
      router.push(`/deposits/${res.data?.id}`)
    })
  }

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

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-base" htmlFor="f-item">
              {t('item')}
            </label>
            <input
              id="f-item"
              className="input-base"
              list="deposit-items"
              placeholder={t('itemPlaceholder')}
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              data-testid="deposit-item"
            />
            <datalist id="deposit-items">
              {items.map((i) => (
                <option key={i.id} value={i.name} />
              ))}
            </datalist>
            <p className="help-text">{t('itemHelp')}</p>
            {errors.item && <p className="help-text text-urgent">{errors.item}</p>}
          </div>
          <div>
            <label className="label-base" htmlFor="f-qty">
              {t('quantity')}
            </label>
            <input
              id="f-qty"
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              className="input-base tnum"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              data-testid="deposit-quantity"
            />
            {errors.quantity && <p className="help-text text-urgent">{errors.quantity}</p>}
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
            {t('submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
