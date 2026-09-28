'use client'

import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'

/**
 * The little markdown the assistant writes: paragraphs, headings, - and 1. lists, **bold**,
 * `code` and [links](/app/path). Only in-app paths become links — anything else stays text.
 */
function inline(text: string, onNavigate: () => void, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>)
    else if (m[2]) out.push(<code key={k} className="rounded bg-surface-2 px-1 text-[0.92em] tnum">{m[2]}</code>)
    else if (m[3] && m[4]?.startsWith('/') && !m[4].startsWith('//')) {
      out.push(
        <Link key={k} href={m[4]} onClick={onNavigate} className="font-semibold text-brand underline underline-offset-2">
          {m[3]}
        </Link>,
      )
    } else out.push(m[3] ?? m[0])
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function AiMarkdown({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []

  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), onNavigate, `p${blocks.length}`)}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const k = `l${blocks.length}`
    const items = list.items.map((it, i) => <li key={i}>{inline(it, onNavigate, `${k}-${i}`)}</li>)
    blocks.push(
      list.ordered ? (
        <ol key={k} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={k} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      ),
    )
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const head = /^#{1,4}\s+(.*)$/.exec(line)
    if (!line.trim()) {
      flushPara()
      flushList()
    } else if (head) {
      flushPara()
      flushList()
      blocks.push(
        <p key={`h${blocks.length}`} className="font-semibold text-ink">
          {inline(head[1], onNavigate, `h${blocks.length}`)}
        </p>,
      )
    } else if (bullet || num) {
      flushPara()
      const ordered = Boolean(num)
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? num)![1])
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  return <div className="space-y-2 text-sm leading-relaxed">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}
