import 'server-only'
import { join } from 'node:path'
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { APP_NAME, SHOP_NAME } from '@/lib/constants'
import { REPORT_TOTAL_KEYS, reportTotals, showRate, type Report } from './overview'

type T = (key: string, values?: Record<string, string | number>) => string

/**
 * The owner's PDF report. Thai needs an embedded font: react-pdf reads the bundled Sarabun
 * TTFs from disk (RULINGS R-023 — screens keep IBM Plex Sans Thai). Read from the file system,
 * never from a URL built from the request's Host header; next.config traces public/fonts
 * into this route's function.
 */
let registered = false
function registerFont() {
  if (registered) return
  const dir = join(process.cwd(), 'public', 'fonts')
  Font.register({
    family: 'Sarabun',
    fonts: [
      { src: join(dir, 'Sarabun-Regular.ttf') },
      { src: join(dir, 'Sarabun-Bold.ttf'), fontWeight: 'bold' },
    ],
  })
  // Thai has no spaces between words — never hyphenate, let lines break anywhere
  Font.registerHyphenationCallback((word) => [word])
  registered = true
}

const s = StyleSheet.create({
  page: { fontFamily: 'Sarabun', fontSize: 9, padding: 28, color: '#1c1917' },
  h1: { fontSize: 16, fontWeight: 'bold' },
  sub: { fontSize: 9, color: '#57534e', marginTop: 2, marginBottom: 12 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#d6d3d1', paddingVertical: 4 },
  head: { fontWeight: 'bold', backgroundColor: '#f5f5f4' },
  total: { fontWeight: 'bold' },
  name: { width: 90, paddingRight: 4 },
  cell: { flex: 1, textAlign: 'right', paddingHorizontal: 2 },
  foot: { position: 'absolute', bottom: 16, left: 28, right: 28, fontSize: 8, color: '#78716c', flexDirection: 'row', justifyContent: 'space-between' },
})

const COL_KEY: Record<(typeof REPORT_TOTAL_KEYS)[number], string> = {
  deposits_new: 'colNewDeposits',
  bottles_new: 'colBottlesNew',
  withdrawals: 'colWithdrawals',
  bottles_withdrawn: 'colBottlesWithdrawn',
  expired: 'colExpired',
  disposed: 'colDisposed',
  bookings: 'colBookings',
  arrived: 'colArrived',
  no_shows: 'colNoShows',
  cancelled: 'colCancelled',
}

export async function buildPdf(report: Report, t: T, labels: { range: string; generated: string }): Promise<Buffer> {
  registerFont()
  const totals = reportTotals(report.branches)
  const rate = (a: number, n: number) => {
    const r = showRate(a, n)
    return r === null ? '—' : `${r}%`
  }

  const doc = (
    <Document title={t('pdfTitle')} author={APP_NAME}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>{`${t('pdfTitle')} · ${SHOP_NAME}`}</Text>
        <Text style={s.sub}>{labels.range}</Text>

        <View style={[s.row, s.head]} fixed>
          <Text style={s.name}>{t('branch')}</Text>
          {REPORT_TOTAL_KEYS.map((k) => (
            <Text key={k} style={s.cell}>
              {t(COL_KEY[k])}
            </Text>
          ))}
          <Text style={s.cell}>{t('colShowRate')}</Text>
        </View>
        {report.branches.map((b) => (
          <View key={b.id} style={s.row} wrap={false}>
            <Text style={s.name}>{b.name}</Text>
            {REPORT_TOTAL_KEYS.map((k) => (
              <Text key={k} style={s.cell}>
                {String(Number(b[k]) || 0)}
              </Text>
            ))}
            <Text style={s.cell}>{rate(b.arrived, b.no_shows)}</Text>
          </View>
        ))}
        <View style={[s.row, s.total]} wrap={false}>
          <Text style={s.name}>{t('total')}</Text>
          {REPORT_TOTAL_KEYS.map((k) => (
            <Text key={k} style={s.cell}>
              {String(totals[k])}
            </Text>
          ))}
          <Text style={s.cell}>{rate(totals.arrived, totals.no_shows)}</Text>
        </View>

        <View style={s.foot} fixed>
          <Text>{labels.generated}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
  return renderToBuffer(doc)
}
