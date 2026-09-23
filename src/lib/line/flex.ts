import { clip } from './format'

/**
 * The LINE Flex bubble every message uses: a dark header (eyebrow + title), a body of short
 * wrapped lines, and at most one link button. Colours are the design tokens (DESIGN.md):
 * customer = "Night Bar" header over the cream body, staff = the staff app sidebar + brand.
 * LINE renders Flex with literal hex colours — there is no CSS here to read tokens from.
 */

export type FlexText = { type: 'text'; text: string; wrap?: boolean; size?: string; weight?: string; color?: string }
export type FlexButton = { type: 'button'; style: 'primary'; color: string; height: 'sm'; action: { type: 'uri'; label: string; uri: string } }
export type FlexBox = { type: 'box'; layout: 'vertical'; spacing?: string; paddingAll?: string; backgroundColor?: string; contents: (FlexText | FlexButton)[] }
export type FlexBubble = { type: 'bubble'; size: 'kilo'; header: FlexBox; body: FlexBox; footer?: FlexBox }
export type FlexMessage = { type: 'flex'; altText: string; contents: FlexBubble }
export type TextMessage = { type: 'text'; text: string }
export type LineMessage = FlexMessage | TextMessage

export type Theme = 'customer' | 'staff'

const COLORS: Record<Theme, { header: string; eyebrow: string; title: string; body: string; ink: string; muted: string; button: string }> = {
  // --cx-card / --cx-gold / --cx-ink (Night Bar) · body = cream --cx-card, --cx-ink, --cx-muted · button --cx-wine (cream)
  customer: { header: '#1F1517', eyebrow: '#D9B26A', title: '#F6EEE6', body: '#FFFFFF', ink: '#2A1A15', muted: '#6E5A53', button: '#8E1B22' },
  // --brand-sidebar / --sidebar-fg-dim / --sidebar-title · body --card, --ink, --muted · button --brand
  staff: { header: '#221619', eyebrow: '#A8999B', title: '#FFFFFF', body: '#FFFFFF', ink: '#1E1718', muted: '#6E6466', button: '#9A1F2A' },
}

/** LINE limits: altText ≤ 400, a text component well under 2,000, a button label ≤ 40. */
export const ALT_MAX = 400
const TEXT_MAX = 1000
const LABEL_MAX = 40

export function bubble(opts: {
  theme: Theme
  eyebrow: string
  title: string
  lines: { text: string; muted?: boolean; strong?: boolean }[]
  altText: string
  button?: { label: string; uri: string } | null
}): FlexMessage {
  const c = COLORS[opts.theme]
  const lines = opts.lines.filter((l) => l.text.trim() !== '')
  const contents: FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      paddingAll: '16px',
      backgroundColor: c.header,
      contents: [
        { type: 'text', text: clip(opts.eyebrow, 80) || ' ', size: 'xs', color: c.eyebrow, wrap: true },
        { type: 'text', text: clip(opts.title, 120) || ' ', size: 'lg', weight: 'bold', color: c.title, wrap: true },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      backgroundColor: c.body,
      contents: (lines.length ? lines : [{ text: ' ' }]).map((l) => ({
        type: 'text' as const,
        text: clip(l.text, TEXT_MAX) || ' ',
        size: l.strong ? 'md' : 'sm',
        wrap: true,
        color: l.muted ? c.muted : c.ink,
        ...(l.strong ? { weight: 'bold' } : {}),
      })),
    },
  }
  if (opts.button && opts.button.uri) {
    contents.footer = {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      backgroundColor: c.body,
      contents: [
        { type: 'button', style: 'primary', color: c.button, height: 'sm', action: { type: 'uri', label: clip(opts.button.label, LABEL_MAX), uri: opts.button.uri } },
      ],
    }
  }
  return { type: 'flex', altText: clip(opts.altText, ALT_MAX) || clip(opts.title, ALT_MAX) || ' ', contents }
}

export function text(value: string): TextMessage {
  return { type: 'text', text: clip(value, TEXT_MAX) || ' ' }
}
