#!/usr/bin/env node
/**
 * verify-contrast.mjs — WCAG AA (4.5:1) for every text × background pair the
 * app renders, in all four palettes: staff light, staff dark, LIFF wine & gold
 * (Davis's customer page, R-035), LIFF cream. A translucent surface is judged
 * over the stack that shows through it — glass card over the page's lightest
 * gradient stop, chip over that card — never over white.
 *
 * Project version of thai-admin-page-kit/verify-contrast.mjs. The kit's copy
 * cannot read this stylesheet: our kit-only tokens are derived with var() and
 * color-mix() (DESIGN.md "Token mapping"), and the primary button puts
 * --on-brand — not white — on --brand-solid (dark mode's brand is light pink
 * with dark text). Both are resolved here.
 *
 *   node scripts/verify-contrast.mjs [src/app/globals.css]
 *   node scripts/verify-contrast.mjs --self-test
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* ── colour maths ──────────────────────────────────────────────────────── */
const hex = (h) => {
  const s = h.replace('#', '').trim()
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
}
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
export const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/* ── read a selector's declarations ────────────────────────────────────── */
export function block(css, selector) {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`)
  const m = re.exec(css)
  if (!m) return null
  const start = m.index + m[0].length
  const body = css.slice(start, css.indexOf('\n}', start))
  const out = {}
  for (const d of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim()
  return out
}

/* resolve a value to [r,g,b,a] against a token map; composite later */
export function resolve(value, tokens, depth = 0) {
  if (depth > 20 || value == null) return null
  const v = value.trim()
  if (v.startsWith('#')) return [...hex(v), 1]
  if (v === 'transparent') return [0, 0, 0, 0]
  let m = v.match(/^var\(--([a-z0-9-]+)\)$/)
  if (m) return resolve(tokens[m[1]], tokens, depth + 1)
  m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/)
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : parseFloat(m[4])]
  m = v.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/)
  if (m) {
    const a = resolve(m[1], tokens, depth + 1)
    const b = resolve(m[3], tokens, depth + 1)
    if (!a || !b) return null
    const p = parseFloat(m[2]) / 100
    // premultiplied mix, as CSS Color 5 specifies
    const alpha = a[3] * p + b[3] * (1 - p)
    if (alpha === 0) return [0, 0, 0, 0]
    const ch = [0, 1, 2].map((i) => (a[i] * a[3] * p + b[i] * b[3] * (1 - p)) / alpha)
    return [...ch, alpha]
  }
  return null
}
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]))

/* ── the pairs that exist on screen ────────────────────────────────────── */
// [fg, bg, …what shows through a translucent bg, down to an opaque base]
const STAFF = [
  ['ink', 'canvas'], ['ink', 'card'], ['ink', 'surface-2'],
  ['ink-2', 'card'], ['ink-2', 'canvas'],
  ['muted', 'canvas'], ['muted', 'card'], ['muted', 'surface-2'], ['muted', 'surface-3'],
  ['placeholder', 'card'],
  ['brand', 'card'], ['brand', 'canvas'], ['brand-on-tint', 'brand-tint'],
  ['on-brand', 'brand-solid'], ['on-brand', 'brand-solid-hover'], ['on-brand', 'brand-solid-active'],
  ['on-done', 'status-done'], ['WHITE', 'urgent-solid'],
  ['canvas', 'ink'], // selected tab: canvas text on ink
  ['sidebar-title', 'sidebar'], ['sidebar-fg', 'sidebar'], ['sidebar-fg-dim', 'sidebar'],
  ['sidebar-active-fg', 'sidebar-active-bg', 'sidebar'], ['sidebar-fg', 'sidebar-hover', 'sidebar'],
  ['accent', 'sidebar'], // raised scan FAB icon
  ['status-pending', 'status-pending-bg'], ['status-progress', 'status-progress-bg'],
  ['status-done', 'status-done-bg'], ['status-info', 'status-info-bg'], ['urgent', 'urgent-bg'],
  ['gold-ink', 'gold-bg'],
  ['status-pending', 'card'], ['status-progress', 'card'], ['status-done', 'card'],
  ['status-info', 'card'], ['urgent', 'card'],
]
const CX = [
  // text straight on the page — cx-bg is the gradient's lightest stop
  ['cx-ink', 'cx-bg'], ['cx-muted', 'cx-bg'], ['cx-gold', 'cx-bg'], ['cx-warn', 'cx-bg'],
  // glass cards and bars over the page; chips and pressed states inside a card
  ['cx-ink', 'cx-card', 'cx-bg'], ['cx-muted', 'cx-card', 'cx-bg'], ['cx-gold', 'cx-card', 'cx-bg'],
  ['cx-ink', 'cx-card-2', 'cx-card', 'cx-bg'], ['cx-muted', 'cx-card-2', 'cx-card', 'cx-bg'],
  ['cx-gold', 'cx-card-2', 'cx-card', 'cx-bg'], ['cx-warn', 'cx-warn-bg', 'cx-card', 'cx-bg'],
  ['cx-ink', 'cx-bar', 'cx-bg'], ['cx-muted', 'cx-bar', 'cx-bg'], ['cx-gold', 'cx-bar', 'cx-bg'],
  // dialogs and sheets (solid), and what sits on them
  ['cx-ink', 'cx-sheet'], ['cx-muted', 'cx-sheet'], ['cx-gold', 'cx-sheet'], ['cx-warn', 'cx-sheet'],
  ['cx-ink', 'cx-card', 'cx-sheet'], ['cx-gold', 'cx-card-2', 'cx-sheet'], ['cx-danger', 'cx-danger-bg', 'cx-sheet'],
  // the filled button and the logo tile
  ['cx-on-btn', 'cx-btn-solid'], ['cx-on-logo', 'cx-logo-from'],
]

/** Contrast of fg over a stack of layers: [its own bg, …what shows through, the opaque base]. */
export function pairRatio(t, fg, layers) {
  let b = [255, 255, 255]
  for (const layer of [...layers].reverse()) {
    const c = resolve(t[layer], t)
    if (!c) return null
    b = over(c, b)
  }
  const f0 = fg === 'WHITE' ? [255, 255, 255, 1] : resolve(t[fg], t)
  if (!f0) return null
  return ratio(over(f0, b), b)
}

export function score(css) {
  const light = block(css, ':root')
  const dark = block(css, '.dark')
  const night = block(css, '.cx')
  const cream = block(css, ".cx[data-cx-theme='light']")
  const themes = []
  if (light) themes.push(['STAFF LIGHT', light, STAFF])
  if (light && dark) themes.push(['STAFF DARK', { ...light, ...dark }, STAFF])
  if (night) themes.push(['LIFF WINE & GOLD', night, CX])
  if (night && cream) themes.push(['LIFF CREAM', { ...night, ...cream }, CX])
  const rows = []
  for (const [name, t, pairs] of themes) {
    for (const [fg, ...layers] of pairs) rows.push({ theme: name, fg, bg: layers.join(' over '), ratio: pairRatio(t, fg, layers) })
  }
  return { themes: themes.length, rows }
}

function report(css) {
  const { themes, rows } = score(css)
  let fails = 0, missing = 0, cur = ''
  for (const r of rows) {
    if (r.theme !== cur) { cur = r.theme; console.log(`\n${'═'.repeat(46)}\n${cur}`) }
    if (r.ratio == null) { missing++; console.log(`  ??    ${r.fg} on ${r.bg}  (token missing / unparsable)`); continue }
    const ok = r.ratio >= 4.5
    if (!ok) fails++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${r.ratio.toFixed(2).padStart(5)}  ${r.fg} on ${r.bg}`)
  }
  const checked = rows.length - missing
  console.log(`\n${themes} palettes · ${checked} pairs checked · ${fails} below 4.5:1 · ${missing} unresolved`)
  // a scan that found nothing to scan must fail
  if (themes < 4 || checked === 0) { console.log('FAIL: expected 4 palettes (:root, .dark, .cx, .cx[data-cx-theme=\'light\'])'); return 1 }
  return fails || missing ? 1 : 0
}

function selfTest() {
  const good = `:root {\n  --canvas: #FFFFFF;\n  --ink: #000000;\n  --mix: color-mix(in srgb, var(--ink) 50%, var(--canvas));\n}`
  const mix = resolve(block(good, ':root').mix, block(good, ':root'))
  const cases = [
    ['color-mix resolves to mid grey', Math.round(mix[0]) === 128],
    ['black on white is 21:1', Math.round(ratio([0, 0, 0], [255, 255, 255])) === 21],
    ['missing palettes fail', report(':root {\n  --ink: #000;\n}') === 1],
  ]
  const bad = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')
    .replace('--on-brand: #230A0E;', '--on-brand: #FFFFFF;') // white on light-pink brand in dark
  cases.push(['white on dark-mode brand fails', report(bad) === 1])
  // white on 10 % white glass: fine over black, invisible when the glass is judged over white
  const glass = block(':root {\n  --ink: #FFFFFF;\n  --page: #000000;\n  --glass: rgba(255, 255, 255, 0.1);\n}', ':root')
  cases.push(['glass is judged over what shows through it', pairRatio(glass, 'ink', ['glass', 'page']) > 10 && pairRatio(glass, 'ink', ['glass']) < 1.5])
  let failed = 0
  for (const [name, ok] of cases) { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} self-test: ${name}`) }
  return failed ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--self-test')) process.exit(selfTest())
  const file = process.argv[2] ?? 'src/app/globals.css'
  process.exit(report(readFileSync(file, 'utf8')))
}
