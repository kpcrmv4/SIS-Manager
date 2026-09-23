/** Pure geometry of the overview's 8-week sparkline (no JSX — the specs import it). */

export const SPARK_W = 100
export const SPARK_H = 28
export const SPARK_PAD = 3

/**
 * y grows downward; the scale starts at 0 (direction, not magnitude, is the point). A null value
 * breaks the line (a week with nothing to measure is not a zero) and leaves the area unfilled.
 */
export function sparkGeometry(values: (number | null)[], max?: number) {
  const n = values.length
  const top = Math.max(max ?? 0, ...values.map((v) => v ?? 0), 1)
  const x = (i: number) => (n <= 1 ? SPARK_W / 2 : SPARK_PAD + (i * (SPARK_W - 2 * SPARK_PAD)) / (n - 1))
  const y = (v: number) => SPARK_H - SPARK_PAD - (v / top) * (SPARK_H - 2 * SPARK_PAD)
  let line = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null) {
      pen = false
      return
    }
    line += `${pen ? 'L' : 'M'}${x(i).toFixed(2)} ${y(v).toFixed(2)} `
    pen = true
  })
  const complete = n > 1 && values.every((v) => v !== null)
  const area = complete ? `${line}L${x(n - 1).toFixed(2)} ${SPARK_H - SPARK_PAD} L${x(0).toFixed(2)} ${SPARK_H - SPARK_PAD} Z` : null
  let lastIndex = -1
  values.forEach((v, i) => {
    if (v !== null) lastIndex = i
  })
  const last = lastIndex < 0 ? null : { x: x(lastIndex), y: y(values[lastIndex] as number) }
  return { line: line.trim(), area, last }
}
