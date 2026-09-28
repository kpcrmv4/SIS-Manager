'use client'

import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'

/**
 * The little markdown the assistant writes: paragraphs, headings, - and 1. lists, tables, rules,
 * **bold**, `code` and [links](/app/path). Only in-app paths become links — anything else stays text.
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

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
const isRule = (row: string) => cells(row).every((c) => /^:?-{2,}:?$/.test(c))

/**
 * R-073: a markdown table. Up to three columns fit a phone as a table; wider ones become a card per
 * row — the first cell as its title (usually the DEP / BK code), the rest as label: value.
 */
function Table({ rows, onNavigate, k }: { rows: string[]; onNavigate: () => void; k: string }) {
  const [head, ...rest] = rows
  const header = cells(head)
  const body = rest.filter((r) => !isRule(r)).map(cells)
  if (header.length <= 3) {
    return (
      <div className="-mx-1 overflow-x-auto" data-testid="ai-table">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i} className="border-b border-line px-1.5 py-1 text-left font-semibold text-muted-token">
                  {inline(h, onNavigate, `${k}h${i}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0">
                {header.map((_, j) => (
                  <td key={j} className="px-1.5 py-1 align-top tnum">
                    {inline(r[j] ?? '', onNavigate, `${k}${i}-${j}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="ai-table-cards">
      {body.map((r, i) => (
        <div key={i} className="rounded-lg border border-line-soft bg-card px-2.5 py-2" data-testid="ai-table-card">
          <p className="mb-1 text-[13px] font-semibold text-ink">{inline(r[0] ?? '', onNavigate, `${k}${i}t`)}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-[13px]">
            {header.slice(1).map((h, j) =>
              r[j + 1] ? (
                <div key={j} className="contents">
                  <dt className="text-muted-token">{h}</dt>
                  <dd className="min-w-0 break-words text-ink tnum">{inline(r[j + 1], onNavigate, `${k}${i}-${j}`)}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </div>
      ))}
    </div>
  )
}

export function AiMarkdown({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  let table: string[] | null = null

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

  const flushTable = () => {
    if (!table) return
    const k = `t${blocks.length}`
    // a header and at least one row, else it was just a line with bars in it
    if (table.length >= 2) blocks.push(<Table key={k} k={k} rows={table} onNavigate={onNavigate} />)
    else para.push(...table)
    table = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara()
      flushList()
      ;(table ??= []).push(line)
      continue
    }
    flushTable()
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara()
      flushList()
      blocks.push(<hr key={`r${blocks.length}`} className="border-line-soft" />)
      continue
    }
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
  flushTable()
  flushPara()
  flushList()
  return <div className="space-y-2 text-sm leading-relaxed">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}
