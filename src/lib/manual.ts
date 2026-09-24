import 'server-only'
import type { Role } from '@/lib/auth/actor'
import th from '../../messages/manual/th.json'
import en from '../../messages/manual/en.json'

/**
 * The user manual (/manual): plain text in messages/manual/{th,en}.json, kept out of the staff
 * catalog so it is never shipped with other pages. Read by the page on the server only.
 */
export type ManualHowto = { title: string; roles: Role[]; steps: string[] }
export type ManualSection = {
  title: string
  path: string
  roles: Role[]
  intro: string
  onPage: string[]
  howtos: Record<string, ManualHowto>
  important: string[]
  tips: string[]
}
export type ManualRoleInfo = { name: string; summary: string; can: string[] }
export type Manual = {
  title: string
  subtitle: string
  labels: { toc: string; access: string; onPage: string; important: string; tip: string; everyone: string; yourRole: string; customerSide: string; backToTop: string }
  concept: { title: string; body: string[]; flows: Record<'deposit' | 'booking', { title: string; steps: string[] }> }
  roles: { title: string; intro: string } & Record<Role, ManualRoleInfo>
  groups: Record<string, { title: string; sections: string[] }>
  sections: Record<string, ManualSection>
}

export function manualFor(locale: string): Manual {
  return (locale === 'en' ? en : th) as unknown as Manual
}

export type RoleSection = { id: string; section: ManualSection; howtos: [string, ManualHowto][] }

/** What this role may read: sections open to it, and in them only the how-tos it can do. */
export function manualForRole(m: Manual, role: Role): { id: string; title: string; sections: RoleSection[] }[] {
  return Object.entries(m.groups)
    .map(([id, g]) => ({
      id,
      title: g.title,
      sections: g.sections
        .filter((sid) => m.sections[sid]?.roles.includes(role))
        .map((sid) => ({ id: sid, section: m.sections[sid], howtos: Object.entries(m.sections[sid].howtos).filter(([, h]) => h.roles.includes(role)) })),
    }))
    .filter((g) => g.sections.length > 0)
}
