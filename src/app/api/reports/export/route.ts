import { NextResponse, type NextRequest } from 'next/server'
import { getTranslations } from 'next-intl/server'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/action'
import { formatShortDate, formatTime } from '@/lib/date'
import { getReport, isYmd } from '@/lib/reports/overview'
import { exportDetails } from '@/lib/reports/export-data'
import { buildXlsx } from '@/lib/reports/export-xlsx'
import { buildPdf } from '@/lib/reports/export-pdf'

export const runtime = 'nodejs'
export const maxDuration = 60

/** GET /api/reports/export?format=xlsx|pdf&from&to[&branch] — owner only (P4-01). */
export async function GET(req: NextRequest) {
  const state = await getActorState()
  if (state.status !== 'ok') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (state.actor.role !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const p = req.nextUrl.searchParams
  const format = p.get('format')
  const from = p.get('from')
  const to = p.get('to')
  const branch = p.get('branch')
  if ((format !== 'xlsx' && format !== 'pdf') || !isYmd(from) || !isYmd(to) || to < from || (branch && !isUuid(branch))) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  const locale = state.actor.locale
  const [t, ts] = await Promise.all([getTranslations({ locale, namespace: 'reports' }), getTranslations({ locale, namespace: 'status' })])
  const tt = (key: string, values?: Record<string, string | number>) => t(key as never, values as never)
  const tst = (key: string) => ts(key as never)

  let report
  try {
    report = await getReport(from, to, branch)
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }

  const range = tt('rangeSubtitle', { from: formatShortDate(`${from}T12:00:00+07:00`, locale), to: formatShortDate(`${to}T12:00:00+07:00`, locale) })
  const now = new Date()
  const stamp = `${from}_${to}`

  if (format === 'xlsx') {
    let details
    try {
      details = await exportDetails(await getSupabaseServer(), from, to, branch)
    } catch {
      return NextResponse.json({ error: 'failed' }, { status: 500 })
    }
    const buf = await buildXlsx(report, details, tt, tst, locale)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="sis-report-${stamp}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  }

  const buf = await buildPdf(report, tt, { range, generated: tt('generatedAt', { date: formatShortDate(now, locale), time: formatTime(now, locale) }) }, req.nextUrl.origin)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="sis-report-${stamp}.pdf"`,
      'cache-control': 'no-store',
    },
  })
}
