import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { getActorState } from '@/lib/auth/actor'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRINTER_NAME_RE = /^.{1,60}$/

// Read from disk at runtime, like Davis did (git show 758a39f). In prod this needs the
// route's output file tracing to include print-server/** — see the P3-B report; it
// works as-is in dev, which is what this worktree can gate on.
const PRINT_SERVER_FILES = [
  'print-server.js',
  'package.json',
  'config.json.example',
  'INSTALL.bat',
  'SETUP.bat',
  'START-PrintServer.bat',
  'RawPrint.ps1',
  'lib/supabase-connector.js',
  'lib/html-renderer.js',
  'lib/job-processor.js',
  'lib/working-hours.js',
  'lib/qr.js',
]

function generatePassword(): string {
  return `Pr-${randomBytes(18).toString('base64url')}`
}

type WorkingHours = { enabled: boolean; startHour: number; startMinute: number; endHour: number; endMinute: number }
const DEFAULT_HOURS: WorkingHours = { enabled: true, startHour: 12, startMinute: 0, endHour: 6, endMinute: 0 }

/**
 * POST /api/print-server/setup — owner only. Creates (or reuses) the branch's print
 * account and returns a ZIP with a fresh config.json + the print-server files. Re-running
 * resets the account's password; the old one stops working (R-021 keeps Davis's
 * print-server as-is, this route is the SIS-shaped account provisioning around it).
 *
 * Never logs the password or the generated config.
 */
export async function POST(req: NextRequest) {
  const state = await getActorState()
  if (state.status !== 'ok') return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (state.actor.role !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as { branchId?: string; printerName?: string } | null
  const branchId = body?.branchId
  if (!branchId || !UUID.test(branchId)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  if (body?.printerName !== undefined && (typeof body.printerName !== 'string' || !PRINTER_NAME_RE.test(body.printerName))) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const { data: branch, error: branchError } = await admin
    .from('branches')
    .select('id, code, name, print_server_working_hours, print_server_printer_name')
    .eq('id', branchId)
    .maybeSingle()
  if (branchError) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  if (!branch) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: existingStation, error: stationReadError } = await admin.from('print_stations').select('account_id').eq('branch_id', branchId).maybeSingle()
  if (stationReadError) return NextResponse.json({ error: 'unavailable' }, { status: 503 })

  const email = `printer-${branch.code.toLowerCase()}@print.sis.local`
  const password = generatePassword()
  let accountId = existingStation?.account_id ?? null

  if (accountId) {
    const { error } = await admin.auth.admin.updateUserById(accountId, { password })
    if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { print_branch: branchId },
    })
    if (error || !data.user) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    accountId = data.user.id

    // handle_new_user() makes a `staff` profile for every new auth user — deactivate it
    // (the print account must never be able to sign in to the staff app) and make sure
    // it carries no branch memberships (it reads its branch through app_metadata.print_branch).
    const { error: profileError } = await admin.from('profiles').update({ active: false }).eq('id', accountId)
    const { error: branchesError } = await admin.from('user_branches').delete().eq('user_id', accountId)
    if (profileError || branchesError) {
      await admin.auth.admin.deleteUser(accountId)
      return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    }
  }

  const { error: stationError } = await admin.from('print_stations').upsert({ branch_id: branchId, account_id: accountId }, { onConflict: 'branch_id' })
  if (stationError) return NextResponse.json({ error: 'unavailable' }, { status: 503 })

  const printerName = (body?.printerName || branch.print_server_printer_name || 'POS80').slice(0, 60)
  const workingHours = (branch.print_server_working_hours as WorkingHours | null) ?? DEFAULT_HOURS

  const config = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: SUPABASE_PUBLISHABLE_KEY,
    STORE_ID: branchId,
    STORE_NAME: branch.name,
    STORE_CODE: branch.code,
    PRINT_ACCOUNT_EMAIL: email,
    PRINT_ACCOUNT_PASSWORD: password,
    PRINTER_NAME: printerName,
    PAPER_WIDTH: 80,
    WORKING_HOURS: workingHours,
    POLL_INTERVAL: 10000,
    HEARTBEAT_INTERVAL: 60000,
  }

  const zip = new JSZip()
  const folder = zip.folder('print-server')!
  folder.file('config.json', JSON.stringify(config, null, 2))

  const root = path.join(process.cwd(), 'print-server')
  for (const file of PRINT_SERVER_FILES) {
    const full = path.join(root, file)
    if (!existsSync(full)) continue
    const content = await readFile(full, 'utf8')
    folder.file(file, content)
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  return new NextResponse(zipBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="print-server-${branch.code}.zip"`,
    },
  })
}
