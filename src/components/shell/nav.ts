import {
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CalendarDays,
  ClipboardList,
  ContactRound,
  History,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  MessageCircle,
  Moon,
  QrCode,
  ScanLine,
  Sparkles,
  Store,
  UserRound,
  UsersRound,
  Wine,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/lib/auth/actor'

export type NavSection = 'catDaily' | 'catReports' | 'catSettings' | 'catAccount'

export type NavItem = {
  key: string
  href: string
  /** key in the `nav` message namespace */
  label: string
  icon: LucideIcon
  roles: readonly Role[]
  section: NavSection
  /** the one raised centre action on phones */
  primary?: boolean
  /** bottom-nav slot on phones (1, 2, 4); items without one live in the เพิ่มเติม sheet */
  slot?: 1 | 2 | 4
  /** routes that should light this item too */
  match?: readonly string[]
  /** routes under this item's href that belong to another item */
  except?: readonly string[]
}

const ALL: readonly Role[] = ['staff', 'bar', 'owner']
const FLOOR: readonly Role[] = ['staff', 'bar']
const OWNER: readonly Role[] = ['owner']

export const NAV: readonly NavItem[] = [
  { key: 'tonight', href: '/tonight', label: 'tonight', icon: Moon, roles: FLOOR, section: 'catDaily', slot: 1 },
  { key: 'overview', href: '/overview', label: 'overview', icon: LayoutDashboard, roles: OWNER, section: 'catDaily', slot: 1 },
  { key: 'deposits', href: '/deposits', label: 'deposits', icon: Wine, roles: ALL, section: 'catDaily', slot: 2, except: ['/deposits/history'] },
  { key: 'bookings', href: '/bookings', label: 'bookings', icon: CalendarDays, roles: ALL, section: 'catDaily', slot: 4 },
  { key: 'scan', href: '/scan', label: 'scan', icon: ScanLine, roles: ALL, section: 'catDaily', primary: true },
  // R-048 / R-049 — every role, first under รายงาน (ภาพรวมและรายงาน in the เพิ่มเติม sheet)
  { key: 'customers', href: '/customers', label: 'customers', icon: ContactRound, roles: ALL, section: 'catReports' },
  // R-061 — every role, their branch's deposit and withdrawal events
  { key: 'depositHistory', href: '/deposits/history', label: 'depositHistory', icon: ClipboardList, roles: ALL, section: 'catReports' },
  // R-080 — every role: the branch's LINE OA QR for a customer to add the shop
  { key: 'lineQr', href: '/line-qr', label: 'lineQr', icon: QrCode, roles: ALL, section: 'catDaily' },
  { key: 'reports', href: '/reports', label: 'reports', icon: BarChart3, roles: OWNER, section: 'catReports' },
  { key: 'audit', href: '/audit', label: 'audit', icon: History, roles: OWNER, section: 'catReports' },
  { key: 'settingsBooking', href: '/settings/booking', label: 'settingsBooking', icon: CalendarCheck2, roles: OWNER, section: 'catSettings' },
  { key: 'settingsTables', href: '/settings/tables', label: 'settingsTables', icon: LayoutGrid, roles: OWNER, section: 'catSettings' },
  { key: 'settingsItems', href: '/settings/items', label: 'settingsItems', icon: ListChecks, roles: OWNER, section: 'catSettings' },
  { key: 'settingsUsers', href: '/settings/users', label: 'settingsUsers', icon: UsersRound, roles: OWNER, section: 'catSettings' },
  { key: 'settingsBranch', href: '/settings/branch', label: 'settingsBranch', icon: Store, roles: OWNER, section: 'catSettings' },
  { key: 'settingsLine', href: '/settings/line', label: 'settingsLine', icon: MessageCircle, roles: OWNER, section: 'catSettings' },
  // R-070 — who may use the assistant, its API key and model
  { key: 'settingsAi', href: '/settings/ai', label: 'settingsAi', icon: Sparkles, roles: OWNER, section: 'catSettings' },
  { key: 'me', href: '/me', label: 'me', icon: UserRound, roles: ALL, section: 'catAccount' },
  { key: 'manual', href: '/manual', label: 'manual', icon: BookOpen, roles: ALL, section: 'catAccount' },
]

export function navFor(role: Role) {
  return NAV.filter((i) => i.roles.includes(role))
}

export function isActive(item: NavItem, pathname: string) {
  if ((item.except ?? []).some((m) => pathname === m || pathname.startsWith(`${m}/`))) return false
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true
  return (item.match ?? []).some((m) => pathname === m || pathname.startsWith(`${m}/`))
}
