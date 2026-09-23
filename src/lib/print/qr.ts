import 'server-only'
import QRCode from 'qrcode'

/** The LINE OA "add friend" deep link customers scan from the receipt — built from the branch's bot user id (worker A's /settings/line writes `branches.line_bot_user_id`). */
export function lineAddFriendUrl(lineBotUserId: string): string {
  return `https://line.me/R/ti/p/${encodeURIComponent(lineBotUserId)}`
}

/** A PNG data URL for `text` — stored once in `receipt_settings.qr_code_image_url`, read as-is by the print-server renderer. */
export async function pngDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
}
