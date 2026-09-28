'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Check, KeyRound, ListRestart, Loader2, PlugZap, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { listAiModels, removeAiKey, saveAiKey, saveAiSettings, testAi, type AiUsageMonth } from '@/lib/ai/settings-actions'
import type { AiConfig } from '@/lib/ai/config'
import type { Role } from '@/lib/auth/actor'

const ROLES: Role[] = ['staff', 'bar', 'owner']
const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']

/** R-070 · /settings/ai: who may open the assistant, the API key and the model, and this month's use. */
export function AiSettings({ initial, usage }: { initial: AiConfig; usage: AiUsageMonth | null }) {
  const t = useTranslations('settingsAi')
  const te = useTranslations('errors')
  const tc = useTranslations('common')
  const [config, setConfig] = useState(initial)
  const [model, setModel] = useState(initial.model)
  const [key, setKey] = useState('')
  // R-072: the ids this key can use, fetched from Anthropic on demand — models change often, so the
  // field stays free text and these are only shortcuts
  const [available, setAvailable] = useState<{ id: string; name: string }[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [, start] = useTransition()

  const fail = (code: string): void => {
    toast.error(t.has(`errors.${code}`) ? t(`errors.${code}`) : te(code === 'forbidden' ? 'FORBIDDEN' : 'invalid'))
  }

  function toggleRole(role: Role) {
    const on = config.enabledRoles.includes(role)
    const next = on ? config.enabledRoles.filter((r) => r !== role) : [...config.enabledRoles, role]
    setBusy(`role-${role}`)
    start(async () => {
      const res = await saveAiSettings({ enabledRoles: next, model: config.model })
      setBusy(null)
      if (!res.ok) return fail(res.error)
      setConfig(res.data)
      toast.success(t(on ? 'roleOff' : 'roleOn', { role: t(`role.${role}`) }))
    })
  }

  function saveModel() {
    setBusy('model')
    start(async () => {
      const res = await saveAiSettings({ enabledRoles: config.enabledRoles, model })
      setBusy(null)
      if (!res.ok) return fail(res.error === 'invalid' ? 'model_invalid' : res.error)
      setConfig(res.data)
      toast.success(t('modelSaved', { model: res.data.model }))
    })
  }

  function saveKey() {
    setBusy('key')
    start(async () => {
      const res = await saveAiKey(key)
      setBusy(null)
      if (!res.ok) return fail(res.error)
      setConfig(res.data)
      setKey('')
      toast.success(t('keySaved'))
    })
  }

  function dropKey() {
    setBusy('drop')
    start(async () => {
      const res = await removeAiKey()
      setBusy(null)
      if (!res.ok) return fail(res.error)
      setConfig(res.data)
      toast.success(t('keyRemoved'))
    })
  }

  function fetchModels() {
    setBusy('models')
    start(async () => {
      const res = await listAiModels()
      setBusy(null)
      if (!res.ok) return fail(res.error)
      setAvailable(res.data)
      toast.success(t('modelsFetched', { count: res.data.length }))
    })
  }

  function test() {
    setBusy('test')
    start(async () => {
      const res = await testAi()
      setBusy(null)
      if (!res.ok) return fail(res.error)
      toast.success(t('testOk', { name: res.data.name }))
    })
  }

  const ready = config.hasKey && config.enabledRoles.length > 0

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <section className="card-surface flex items-start gap-3 p-4" data-testid="ai-status" data-ready={ready}>
        <span className={`grid size-10 flex-none place-items-center rounded-full ${ready ? 'bg-status-done-bg text-status-done' : 'bg-surface-2 text-muted-token'}`} aria-hidden>
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{ready ? t('statusOn') : t('statusOff')}</h2>
          <p className="mt-0.5 text-sm text-muted-token">{ready ? t('statusOnBody') : !config.hasKey ? t('statusNoKey') : t('statusNoRole')}</p>
        </div>
      </section>

      <section className="card-surface flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{t('rolesTitle')}</h2>
          <p className="mt-0.5 text-sm text-muted-token">{t('rolesBody')}</p>
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => {
            const on = config.enabledRoles.includes(r)
            return (
              <li key={r}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={t(`role.${r}`)}
                  disabled={busy === `role-${r}`}
                  onClick={() => toggleRole(r)}
                  data-testid={`ai-role-${r}`}
                  data-on={on}
                  className={`flex h-full w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left transition duration-150 active:scale-[0.98] disabled:cursor-wait ${
                    on ? 'border-line bg-card shadow-e1 hover:border-line-strong' : 'border-dashed border-line bg-surface-2 opacity-55 hover:opacity-75'
                  }`}
                >
                  <span
                    className={`inline-flex w-fit items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${on ? 'bg-status-done-bg text-status-done' : 'bg-line-soft text-muted-token'}`}
                    aria-hidden
                  >
                    {busy === `role-${r}` ? <Loader2 className="size-3 animate-spin" /> : on ? <Check className="size-3" strokeWidth={3} /> : null}
                    {on ? tc('on') : tc('off')}
                  </span>
                  <span className="text-[13px] font-semibold text-ink">{t(`role.${r}`)}</span>
                  <span className="hidden text-xs leading-snug text-muted-token sm:block">{t(`roleHint.${r}`)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="card-surface flex flex-col gap-4 p-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{t('connTitle')}</h2>
          <p className="mt-0.5 text-sm text-muted-token">{t('connBody')}</p>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label className="label-base mb-0" htmlFor="ai-key">
              {t('keyLabel')}
            </label>
            <span className={`inline-flex items-center gap-1 text-xs ${config.hasKey ? 'text-status-done' : 'text-muted-token'}`} data-testid="ai-key-state">
              <KeyRound className="size-3.5" aria-hidden />
              {config.hasKey ? t('keySet', { hint: config.keyHint ?? '' }) : t('keyNotSet')}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              id="ai-key"
              type="password"
              autoComplete="off"
              className="input-base min-w-0 flex-1"
              placeholder={config.hasKey ? t('keyReplace') : 'sk-ant-…'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              data-testid="ai-key-input"
            />
            <button type="button" className="btn-primary" onClick={saveKey} disabled={busy !== null || key.trim().length < 20} data-testid="ai-key-save">
              {busy === 'key' && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {tc('save')}
            </button>
          </div>
          <p className="help-text">{t('keyHelp')}</p>
        </div>

        <div>
          <label className="label-base" htmlFor="ai-model">
            {t('modelLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id="ai-model"
              className="input-base min-w-0 flex-1 tnum"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t('modelPlaceholder')}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              data-testid="ai-model-input"
            />
            <button type="button" className="btn-secondary" onClick={saveModel} disabled={busy !== null || model.trim() === config.model} data-testid="ai-model-save">
              {busy === 'model' && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {tc('save')}
            </button>
          </div>
          <p className="help-text">{t('modelHelp')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="ai-model-options">
            {(available ?? MODELS.map((id) => ({ id, name: id }))).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m.id)}
                title={m.name}
                className={`rounded-full border px-2.5 py-1 text-xs tnum transition-colors ${model === m.id ? 'border-brand bg-brand-tint text-brand-on-tint' : 'border-line text-ink-2 hover:border-line-strong'}`}
                data-testid="ai-model-option"
                data-model={m.id}
              >
                {m.id}
              </button>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={fetchModels} disabled={busy !== null || !config.hasKey} data-testid="ai-models-fetch">
              {busy === 'models' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ListRestart className="size-3.5" aria-hidden />}
              {t('modelsFetch')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
          <button type="button" className="btn-secondary" onClick={test} disabled={busy !== null || !config.hasKey} data-testid="ai-test">
            {busy === 'test' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlugZap className="size-4" aria-hidden />}
            {t('test')}
          </button>
          {config.hasKey && (
            <button type="button" className="btn-ghost text-urgent" onClick={dropKey} disabled={busy !== null} data-testid="ai-key-remove">
              {busy === 'drop' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
              {t('keyRemove')}
            </button>
          )}
        </div>
      </section>

      <section className="card-surface p-4" data-testid="ai-usage">
        <h2 className="text-[15px] font-semibold text-ink">{t('usageTitle')}</h2>
        {usage ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['usageAnswers', usage.answers],
              ['usagePeople', usage.people],
              ['usageIn', usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens],
              ['usageOut', usage.output_tokens],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-xs text-muted-token">{t(k as string)}</dt>
                <dd className="text-lg font-bold text-ink tnum">{Number(v).toLocaleString('en-US')}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-sm text-muted-token">{t('usageNone')}</p>
        )}
        <p className="help-text mt-2">{t('usageHelp')}</p>
      </section>
    </div>
  )
}
