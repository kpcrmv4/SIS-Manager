import Image from 'next/image'
import { APP_NAME, SHOP_NAME } from '@/lib/constants'

export function Brandmark({ subtitle }: { subtitle?: string | null }) {
  return (
    <div className="flex items-center gap-2.5 px-2.5 pb-3.5 pt-1">
      <Image src="/logo.png" alt={SHOP_NAME} width={36} height={36} className="size-9 rounded-[10px] bg-logo" />
      <div className="min-w-0">
        <div className="truncate text-base font-bold leading-tight text-sidebar-title">{APP_NAME}</div>
        {subtitle && <div className="truncate text-[11.5px] text-sidebar-fg-dim">{subtitle}</div>}
      </div>
    </div>
  )
}
