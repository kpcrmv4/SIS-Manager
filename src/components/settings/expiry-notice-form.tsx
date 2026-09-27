'use client'

import { useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Plus, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  EXPIRY_LOCALES,
  EXPIRY_VARIABLES,
  REMINDER_DAY_MAX,
  REMINDER_DAY_MIN,
  REMINDER_MAX,
  TEMPLATE_MAX,
  cleanReminderDays,
  fillExpiryTemplate,
  unknownVariables,
  type ExpiryLocale,
} from '@/lib/line/expiry-template'
import { lineDate, lineDateTime } from '@/lib/line/format'
import { saveExpiryNotices } from '@/lib/settings/expiry-actions'

export type ExpiryNoticeValue = {
  enabled: boolean
  expiredEnabled: boolean
  days: number[]
  time: string
  templates: Partial<Record<ExpiryLocale, string>>
}

type Props = {
  branchId: string
  branchName: string
  branchCode: string
  /** Bangkok today (YYYY-MM-DD) from the server — the preview's dates count from it */
  today: string
  initial: ExpiryNoticeValue
  defaults: Record<ExpiryLocale, string>
}

const addDaysYmd = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const length = (s: string) => Array.from(s).length

/**
 * /settings/branch — แจ้งเตือนหมดอายุทาง LINE (R-044): the branch switch, the time, up to three
 * reminders and the wording in every LIFF language, with a preview filled with sample values.
 */
export function ExpiryNoticeForm({ branchId, branchName, branchCode, today, initial, defaults }: Props) {
  const t = useTranslations('settingsBranch.expiry')
  const tc = useTranslations('common')
  const [enabled, setEnabled] = useState(initial.enabled)
  const [expiredEnabled, setExpiredEnabled] = useState(initial.expiredEnabled)
  const [time, setTime] = useState(initial.time.slice(0, 5))
  const [days, setDays] = useState<string[]>(initial.days.map(String))
  const [lang, setLang] = useState<ExpiryLocale>('th')
  const [texts, setTexts] = useState(() => Object.fromEntries(EXPIRY_LOCALES.map((l) => [l, initial.templates[l] ?? defaults[l]])) as Record<ExpiryLocale, string>)
  const [pending, start] = useTransition()
  const area = useRef<HTMLTextAreaElement>(null)

  const text = texts[lang]
  const isDefault = text.trim() === defaults[lang].trim()
  const unknown = unknownVariables(text)
  const reminderDays = cleanReminderDays(days.map(Number))
  const sampleDay = reminderDays?.[0] ?? 7
  const expires = `${addDaysYmd(today, sampleDay)}T12:00:00+07:00`
  const deadline = `${addDaysYmd(today, sampleDay + 1)}T04:00:00+07:00`
  const preview = fillExpiryTemplate(text, {
    day: String(sampleDay),
    item: 'Johnnie Walker Black Label',
    code: `DEP-${branchCode}-8K2Q4`,
    date: lineDate(expires, lang),
    deadline: lineDateTime(deadline, lang),
    branch: branchName,
  })

  const setText = (l: ExpiryLocale, v: string) => setTexts((s) => ({ ...s, [l]: v }))

  function insert(name: string) {
    const token = `{{${name}}}`
    const el = area.current
    const from = el?.selectionStart ?? text.length
    const to = el?.selectionEnd ?? text.length
    setText(lang, text.slice(0, from) + token + text.slice(to))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(from + token.length, from + token.length)
    })
  }

  function save() {
    if (!reminderDays) {
      toast.error(t('errDays'))
      return
    }
    for (const l of EXPIRY_LOCALES) {
      const bad = unknownVariables(texts[l])
      const problem = !texts[l].trim()
        ? t('errEmpty')
        : bad.length
          ? t('errUnknown', { names: bad.map((b) => `{{${b}}}`).join(', ') })
          : length(texts[l]) > TEMPLATE_MAX
            ? t('errTooLong', { max: TEMPLATE_MAX })
            : null
      if (problem) {
        setLang(l)
        toast.error(`${t(`languages.${l}`)} · ${problem}`)
        return
      }
    }
    start(async () => {
      const res = await saveExpiryNotices(branchId, { enabled, expiredEnabled, days: reminderDays, time, templates: texts })
      if (!res.ok) {
        toast.error(res.error === 'days' ? t('errDays') : res.error === 'time' ? t('errTime') : tc('errorGeneric'))
        return
      }
      setDays(reminderDays.map(String))
      toast.success(tc('saved'))
    })
  }

  return (
    <section className="card-surface flex flex-col gap-4 p-4" data-testid="expiry-form">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{t('title')}</h2>
        <p className="text-sm text-muted-token">{t('hint')}</p>
      </div>

      {/* one time for both messages */}
      <div className={enabled || expiredEnabled ? '' : 'opacity-60'}>
        <label className="label-base" htmlFor="ex-time">
          {t('time')}
        </label>
        <input id="ex-time" type="time" step={300} className="input-base tnum w-36" value={time} onChange={(e) => setTime(e.target.value)} data-testid="expiry-time" />
        <p className="help-text">{t('timeHelp')}</p>
      </div>

      {/* R-064: the reminders before and the message after switch apart — some shops want only the reminders */}
      <div className="rounded-md border border-line-soft p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink">{t('enabled')}</span>
          <button type="button" role="switch" aria-checked={enabled} aria-label={t('enabled')} className="tg" onClick={() => setEnabled((v) => !v)} data-testid="expiry-enabled" />
        </div>
        <p className="help-text">{t('enabledHelp')}</p>

      <div className={`mt-4 flex flex-col gap-4 ${enabled ? '' : 'opacity-60'}`}>

        <div>
          <div className="label-base">{t('days')}</div>
          <div className="flex flex-wrap items-end gap-3">
            {days.map((d, i) => (
              <div key={i} className="flex items-end gap-1.5">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-token">{t('dayLabel', { n: i + 1 })}</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={REMINDER_DAY_MIN}
                      max={REMINDER_DAY_MAX}
                      className="input-base tnum w-20"
                      value={d}
                      onChange={(e) => setDays((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                      data-testid={`expiry-day-${i}`}
                    />
                    <span className="text-sm text-muted-token">{t('dayUnit')}</span>
                  </span>
                </label>
                {days.length > 1 && (
                  <button type="button" className="btn-ghost btn-sm" aria-label={t('removeDay', { n: i + 1 })} onClick={() => setDays((s) => s.filter((_, j) => j !== i))} data-testid={`expiry-remove-day-${i}`}>
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            ))}
            {days.length < REMINDER_MAX && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDays((s) => [...s, ''])} data-testid="expiry-add-day">
                <Plus className="size-4" aria-hidden />
                {t('addDay')}
              </button>
            )}
          </div>
          <p className="help-text">{t('daysHelp')}</p>
        </div>

        <div>
          <div className="label-base">{t('message')}</div>
          <p className="help-text mb-2">{t('messageHelp')}</p>
          <div className="tabs mb-2" role="tablist" aria-label={t('message')}>
            {EXPIRY_LOCALES.map((l) => (
              <button key={l} type="button" role="tab" className="tab" aria-selected={lang === l} onClick={() => setLang(l)} data-testid={`expiry-lang-${l}`}>
                {t(`languages.${l}`)}
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {EXPIRY_VARIABLES.map((v) => (
              <button key={v} type="button" className="btn-ghost btn-sm" onClick={() => insert(v)} data-testid={`expiry-var-${v}`}>
                <code className="text-xs">{`{{${v}}}`}</code>
                <span className="text-xs text-muted-token">{t(`variables.${v}`)}</span>
              </button>
            ))}
          </div>
          <textarea
            ref={area}
            lang={lang}
            rows={4}
            className="input-base min-h-28"
            value={text}
            onChange={(e) => setText(lang, e.target.value)}
            aria-label={`${t('message')} · ${t(`languages.${lang}`)}`}
            data-testid="expiry-text"
          />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs ${unknown.length || length(text) > TEMPLATE_MAX ? 'text-urgent' : 'text-muted-token'}`} data-testid="expiry-text-state">
              {unknown.length
                ? t('errUnknown', { names: unknown.map((b) => `{{${b}}}`).join(', ') })
                : `${isDefault ? t('isDefault') : t('custom')} · ${length(text)}/${TEMPLATE_MAX}`}
            </span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setText(lang, defaults[lang])} disabled={isDefault} data-testid="expiry-reset">
              <RotateCcw className="size-3.5" aria-hidden />
              {t('reset')}
            </button>
          </div>
          <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5">
            <div className="mb-1 text-xs font-semibold text-ink-2">{t('preview')}</div>
            <p className="whitespace-pre-line text-sm text-ink" lang={lang} data-testid="expiry-preview">
              {preview}
            </p>
          </div>
        </div>
      </div>
      </div>

      <div className="rounded-md border border-line-soft p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink">{t('expiredEnabled')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={expiredEnabled}
            aria-label={t('expiredEnabled')}
            className="tg"
            onClick={() => setExpiredEnabled((v) => !v)}
            data-testid="expiry-expired-enabled"
          />
        </div>
        <p className="help-text">{t('expiredEnabledHelp')}</p>
      </div>

      <button type="button" className="btn-primary self-start" disabled={pending} onClick={save} data-testid="expiry-save">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {tc('save')}
      </button>
    </section>
  )
}
