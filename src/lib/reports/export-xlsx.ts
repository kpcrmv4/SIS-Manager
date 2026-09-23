import 'server-only'
import ExcelJS from 'exceljs'
import { formatShortDate, formatTime, type AppLocale } from '@/lib/date'
import { REPORT_TOTAL_KEYS, reportTotals, showRate, type Report } from './overview'
import type { exportDetails } from './export-data'

type T = (key: string, values?: Record<string, string | number>) => string

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

function sheet(wb: ExcelJS.Workbook, name: string, header: string[], rows: (string | number)[][]) {
  const ws = wb.addWorksheet(name)
  ws.addRow(header).font = { bold: true }
  for (const r of rows) ws.addRow(r)
  ws.columns.forEach((c) => {
    c.width = 16
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return ws
}

/** สรุป · ฝาก · เบิก · จอง — every label from the staff catalog (`reports.*`, `status.*`). */
export async function buildXlsx(
  report: Report,
  details: Awaited<ReturnType<typeof exportDetails>>,
  t: T,
  ts: T,
  locale: AppLocale,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'SIS Manager'
  const d = (v: string | null) => (v ? formatShortDate(v, locale) : '')
  const dt = (v: string | null) => (v ? `${formatShortDate(v, locale)} ${formatTime(v, locale)}` : '')

  const totals = reportTotals(report.branches)
  const rate = (a: number, n: number) => {
    const r = showRate(a, n)
    return r === null ? '' : `${r}%`
  }
  sheet(
    wb,
    t('sheetSummary'),
    [t('branch'), ...REPORT_TOTAL_KEYS.map((k) => t(COL_KEY[k])), t('colShowRate')],
    [
      ...report.branches.map((b) => [b.name, ...REPORT_TOTAL_KEYS.map((k) => Number(b[k]) || 0), rate(b.arrived, b.no_shows)]),
      [t('total'), ...REPORT_TOTAL_KEYS.map((k) => totals[k]), rate(totals.arrived, totals.no_shows)],
    ],
  )

  sheet(
    wb,
    t('sheetDeposits'),
    [t('branch'), t('colCode'), t('colCustomer'), t('colPhone'), t('colItem'), t('colQty'), t('colRemaining'), t('colStatus'), t('colReceivedAt'), t('colExpiresAt')],
    details.deposits.map((r) => [
      r.branch?.name ?? '',
      r.code,
      r.customer_name,
      r.customer_phone ?? '',
      r.item_name,
      r.quantity,
      r.remaining_qty,
      ts(`deposit.${r.status}`),
      dt(r.received_at),
      r.is_vip ? t('vipNoExpiry') : d(r.expires_at),
    ]),
  )

  sheet(
    wb,
    t('sheetWithdrawals'),
    [t('branch'), t('colCode'), t('colCustomer'), t('colItem'), t('colQty'), t('colType'), t('colTable'), t('colProcessedAt'), t('colByCustomer')],
    details.withdrawals.map((r) => [
      r.branch?.name ?? '',
      r.deposit?.code ?? '',
      r.deposit?.customer_name ?? '',
      r.deposit?.item_name ?? '',
      r.qty,
      t(r.type === 'take_home' ? 'typeTakeHome' : 'typeInStore'),
      r.table_label ?? '',
      dt(r.processed_at),
      r.by_customer ? t('yes') : t('no'),
    ]),
  )

  sheet(
    wb,
    t('sheetBookings'),
    [t('branch'), t('colCode'), t('colNight'), t('colTime'), t('colName'), t('colPhone'), t('colParty'), t('colTable'), t('colSource'), t('colStatus')],
    details.bookings.map((r) => [
      r.branch?.name ?? '',
      r.code,
      d(`${r.night}T12:00:00+07:00`),
      r.slot_time.slice(0, 5),
      r.name,
      r.phone ?? '',
      r.party_size,
      r.table?.label ?? '',
      t(r.source === 'line' ? 'sourceLine' : 'sourceStaff'),
      ts(`booking.${r.status}`),
    ]),
  )

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
