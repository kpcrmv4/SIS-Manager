import { clip } from './format'

/**
 * The LINE Flex bubble every message uses. Customer messages follow the logo: a wine-red
 * gradient header with a gold eyebrow, a thin gold rule, a cream body, wine buttons.
 * Staff-group messages keep the staff app's sidebar + brand. LINE renders Flex with literal
 * hex colours — there is no CSS here to read tokens from.
 */

export type FlexText = { type: 'text'; text: string; wrap?: boolean; size?: string; weight?: string; color?: string; flex?: number; align?: string }
export type FlexButton = {
  type: 'button'
  style: 'primary' | 'link'
  color: string
  height: 'sm' | 'md'
  action: { type: 'uri'; label: string; uri: string }
}
export type FlexImage = { type: 'image'; url: string; size: string; aspectMode: 'cover'; aspectRatio: '1:1' }
export type FlexFiller = { type: 'filler' }
export type FlexGradient = { type: 'linearGradient'; angle: string; startColor: string; endColor: string }
export type FlexBox = {
  type: 'box'
  layout: 'vertical' | 'horizontal' | 'baseline'
  spacing?: string
  margin?: string
  paddingAll?: string
  paddingTop?: string
  paddingBottom?: string
  backgroundColor?: string
  background?: FlexGradient
  cornerRadius?: string
  width?: string
  height?: string
  flex?: number
  justifyContent?: string
  alignItems?: string
  contents: FlexComponent[]
}
export type FlexComponent = FlexText | FlexButton | FlexImage | FlexBox | FlexFiller
export type FlexBubble = { type: 'bubble'; size: 'kilo' | 'mega'; header: FlexBox; body: FlexBox; footer?: FlexBox }
export type FlexMessage = { type: 'flex'; altText: string; contents: FlexBubble }
export type TextMessage = { type: 'text'; text: string }
export type LineMessage = FlexMessage | TextMessage

export type Theme = 'customer' | 'staff'

type Palette = {
  header: string
  headerTo: string
  eyebrow: string
  title: string
  rule: string
  body: string
  ink: string
  muted: string
  button: string
  chip: string
  chipInk: string
}

const COLORS: Record<Theme, Palette> = {
  // logo: wine ribbon (#8E1B22 → #B3262F), gold ring (#D9B26A), cream ground (#FBF6EE)
  customer: {
    header: '#7A141B',
    headerTo: '#B3262F',
    eyebrow: '#F2D9A6',
    title: '#FFF8EE',
    rule: '#D9B26A',
    body: '#FBF6EE',
    ink: '#2A1A15',
    muted: '#6E5A53',
    button: '#8E1B22',
    chip: '#F3E6CF',
    chipInk: '#7A5518',
  },
  // --brand-sidebar / --sidebar-fg-dim / --sidebar-title · body --card, --ink, --muted · button --brand
  staff: {
    header: '#221619',
    headerTo: '#221619',
    eyebrow: '#A8999B',
    title: '#FFFFFF',
    rule: '#9A1F2A',
    body: '#FFFFFF',
    ink: '#1E1718',
    muted: '#6E6466',
    button: '#9A1F2A',
    chip: '#F4ECEC',
    chipInk: '#6E1520',
  },
}

/** LINE limits: altText ≤ 400, a text component well under 2,000, a button label ≤ 40. */
export const ALT_MAX = 400
const TEXT_MAX = 1000
const LABEL_MAX = 40

export type BubbleLine = { text: string; muted?: boolean; strong?: boolean }
export type BubbleRow = { label: string; value: string }
export type BubbleButton = { label: string; uri: string }

export function bubble(opts: {
  theme: Theme
  eyebrow: string
  title: string
  lines: BubbleLine[]
  altText: string
  /** the main action (a filled button) */
  button?: BubbleButton | null
  /** further actions under it (text-style buttons) */
  more?: (BubbleButton | null)[]
  /** label / value pairs under the lines (codes, dates, counts) */
  rows?: BubbleRow[]
  /** a small chip above the title, e.g. the keyword the customer typed */
  badge?: string | null
  /** a quiet line at the very bottom (tips) */
  hint?: string | null
  /** https URL of the shop logo, shown in the header when set */
  logoUrl?: string | null
}): FlexMessage {
  const c = COLORS[opts.theme]
  // "a · b · c" in the body → one row each (owner, 2026-09-24): a card reads as short lines, never
  // one run-on sentence. Titles and the footer hint (a "·" list of keywords) are never split.
  const lines = opts.lines.flatMap((l) => l.text.split(/\s+·\s+/).map((part) => ({ ...l, text: part }))).filter((l) => l.text.trim() !== '')
  const rows = (opts.rows ?? []).filter((r) => r.value.trim() !== '')

  const titleBlock: FlexBox = {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    flex: 1,
    contents: [
      { type: 'text', text: clip(opts.eyebrow, 80) || ' ', size: 'xxs', color: c.eyebrow, wrap: true },
      { type: 'text', text: clip(opts.title, 120) || ' ', size: 'lg', weight: 'bold', color: c.title, wrap: true },
    ],
  }
  const logo: FlexBox | null = opts.logoUrl
    ? {
        type: 'box',
        layout: 'vertical',
        width: '44px',
        height: '44px',
        cornerRadius: '22px',
        backgroundColor: c.body,
        contents: [{ type: 'image', url: opts.logoUrl, size: 'full', aspectMode: 'cover', aspectRatio: '1:1' }],
      }
    : null

  const header: FlexBox = {
    type: 'box',
    layout: 'vertical',
    paddingAll: '16px',
    backgroundColor: c.header,
    ...(c.header !== c.headerTo ? { background: { type: 'linearGradient' as const, angle: '135deg', startColor: c.header, endColor: c.headerTo } } : {}),
    contents: [
      logo
        ? { type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center', contents: [logo, titleBlock] }
        : titleBlock,
    ],
  }

  const body: FlexComponent[] = []
  if (opts.badge) {
    body.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: c.chip,
          cornerRadius: '10px',
          paddingAll: '4px',
          flex: 0,
          contents: [{ type: 'text', text: clip(opts.badge, 30) || ' ', size: 'xxs', weight: 'bold', color: c.chipInk }],
        },
        { type: 'filler' },
      ],
    })
  }
  for (const l of lines.length || rows.length ? lines : [{ text: ' ' }]) {
    body.push({
      type: 'text',
      text: clip(l.text, TEXT_MAX) || ' ',
      size: l.strong ? 'md' : 'sm',
      wrap: true,
      color: l.muted ? c.muted : c.ink,
      ...(l.strong ? { weight: 'bold' } : {}),
    })
  }
  if (rows.length) {
    body.push({
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      margin: 'md',
      paddingAll: '10px',
      cornerRadius: '8px',
      backgroundColor: '#FFFFFF',
      contents: rows.map((r) => ({
        type: 'box' as const,
        layout: 'baseline' as const,
        spacing: 'sm',
        contents: [
          { type: 'text' as const, text: clip(r.label, 40) || ' ', size: 'xs', color: c.muted, flex: 2, wrap: true },
          { type: 'text' as const, text: clip(r.value, 120) || ' ', size: 'sm', weight: 'bold', color: c.ink, flex: 3, align: 'end', wrap: true },
        ],
      })),
    })
  }

  const contents: FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header,
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      backgroundColor: c.body,
      contents: [{ type: 'box', layout: 'vertical', height: '2px', backgroundColor: c.rule, cornerRadius: '1px', margin: 'none', contents: [] }, ...body],
    },
  }

  const buttons: FlexButton[] = []
  if (opts.button?.uri) {
    buttons.push({ type: 'button', style: 'primary', color: c.button, height: 'sm', action: { type: 'uri', label: clip(opts.button.label, LABEL_MAX), uri: opts.button.uri } })
  }
  for (const b of opts.more ?? []) {
    if (b?.uri) buttons.push({ type: 'button', style: 'link', color: c.button, height: 'sm', action: { type: 'uri', label: clip(b.label, LABEL_MAX), uri: b.uri } })
  }
  const hint = opts.hint ? clip(opts.hint, 200) : ''
  if (buttons.length || hint) {
    contents.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      paddingAll: '12px',
      paddingTop: '0px',
      backgroundColor: c.body,
      contents: [...buttons, ...(hint ? [{ type: 'text' as const, text: hint, size: 'xxs', color: c.muted, wrap: true, align: 'center' }] : [])],
    }
  }
  return { type: 'flex', altText: clip(opts.altText, ALT_MAX) || clip(opts.title, ALT_MAX) || ' ', contents }
}

export function text(value: string): TextMessage {
  return { type: 'text', text: clip(value, TEXT_MAX) || ' ' }
}
