import type { ReactNode } from 'react'
import { ArrowUp, BookOpen, Eye, Lightbulb, LogIn, Smartphone, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { Role } from '@/lib/auth/actor'
import { NAV } from '@/components/shell/nav'
import { manualForRole, type Manual, type ManualHowto, type ManualSection } from '@/lib/manual'

const ROLES: Role[] = ['staff', 'bar', 'owner']

/** `**label**` in the manual text names something on screen: shown as a highlighted chip. */
function rich(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 ? (
      <b key={i} className="man-ui">
        {part}
      </b>
    ) : (
      part
    ),
  )
}

/** A numbered step: the li is a two-column grid (number, text), so its text must be ONE element —
 *  bare text runs and label chips would each become a grid cell and stack in the number column. */
function Step({ text }: { text: string }) {
  return (
    <li>
      <span>{rich(text)}</span>
    </li>
  )
}

/** the menu's own icon for a page; the LINE side gets a phone */
function iconFor(path: string, customer: boolean): LucideIcon {
  if (customer) return Smartphone
  if (path.startsWith('/login')) return LogIn
  const hit = NAV.filter((n) => path === n.href || path.startsWith(`${n.href}/`) || path.startsWith(`${n.href}?`)).sort((a, b) => b.href.length - a.href.length)[0]
  return hit?.icon ?? BookOpen
}

function RoleChips({ roles, m }: { roles: Role[]; m: Manual }) {
  return (
    <div className="man-access">
      <span className="man-label">{m.labels.access}</span>
      {roles.length === ROLES.length ? (
        <span className="man-chip">{m.labels.everyone}</span>
      ) : (
        roles.map((r) => (
          <span key={r} className="man-chip">
            {m.roles[r].name}
          </span>
        ))
      )}
    </div>
  )
}

function Callout({ kind, label, children }: { kind: 'important' | 'tip'; label: string; children: ReactNode }) {
  const Icon = kind === 'important' ? TriangleAlert : Lightbulb
  return (
    <div className={`man-callout ${kind}`} data-testid={`manual-${kind}`}>
      <span className="ic" aria-hidden>
        <Icon className="size-4" />
      </span>
      <p>
        <b className="lbl">{label}</b> {children}
      </p>
    </div>
  )
}

function SectionCard({ id, s, howtos, m, customer }: { id: string; s: ManualSection; howtos: [string, ManualHowto][]; m: Manual; customer: boolean }) {
  const Icon = iconFor(s.path, customer)
  return (
    <article id={id} className="man-card man-section" data-testid="manual-section" data-section={id} data-roles={s.roles.join(' ')}>
      <header className="flex items-start gap-3">
        <span className="man-icon" aria-hidden>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="man-title">{s.title}</h3>
          <code className="man-path">{s.path}</code>
        </div>
      </header>
      <RoleChips roles={s.roles} m={m} />
      <p className="man-p">{rich(s.intro)}</p>

      {s.onPage.length > 0 && (
        <div>
          <h4 className="man-h4">
            <Eye className="size-4" aria-hidden />
            {m.labels.onPage}
          </h4>
          <ul className="man-list">
            {s.onPage.map((x, i) => (
              <li key={i}>{rich(x)}</li>
            ))}
          </ul>
        </div>
      )}

      {howtos.map(([hid, h]) => (
        <div key={hid} id={`${id}-${hid}`} className="scroll-mt-4" data-testid="manual-howto" data-roles={h.roles.join(' ')}>
          <h4 className="man-h4">{h.title}</h4>
          {h.roles.length < s.roles.length && <RoleChips roles={h.roles} m={m} />}
          <ol className="man-steps">
            {h.steps.map((x, i) => (
              <Step key={i} text={x} />
            ))}
          </ol>
        </div>
      ))}

      {s.important.map((x, i) => (
        <Callout key={`i${i}`} kind="important" label={m.labels.important}>
          {rich(x)}
        </Callout>
      ))}
      {s.tips.map((x, i) => (
        <Callout key={`t${i}`} kind="tip" label={m.labels.tip}>
          {rich(x)}
        </Callout>
      ))}
    </article>
  )
}

/**
 * คู่มือการใช้งาน: the concept and the three roles first, then every page this role can open —
 * what it is for, what is on it, how to do each task, what to watch and a tip. Plain text.
 */
export function ManualView({ manual: m, role }: { manual: Manual; role: Role }) {
  const groups = manualForRole(m, role)
  return (
    <div id="manual-top" className="mx-auto flex max-w-190 scroll-mt-4 flex-col gap-5" data-testid="manual" data-role={role}>
      <p className="man-role" data-testid="manual-role">
        {m.labels.yourRole.replace('{role}', m.roles[role].name)}
      </p>

      <nav aria-label={m.labels.toc} className="man-card" data-testid="manual-toc">
        <h2 className="man-h2">{m.labels.toc}</h2>
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="man-toc-title">{g.title}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.sections.map((s) => (
                  <a key={s.id} href={`#${s.id}`} className="man-toc-link" data-testid="manual-toc-link">
                    {s.section.title}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <section className="man-card" aria-labelledby="man-concept" data-testid="manual-concept">
        <h2 id="man-concept" className="man-h2">
          {m.concept.title}
        </h2>
        {m.concept.body.map((p, i) => (
          <p key={i} className="man-p">
            {rich(p)}
          </p>
        ))}
        <div className="mt-1 grid gap-3 md:grid-cols-2">
          {(['deposit', 'booking'] as const).map((k) => (
            <div key={k} className="man-flow">
              <h3 className="man-h3">{m.concept.flows[k].title}</h3>
              <ol className="man-steps">
                {m.concept.flows[k].steps.map((x, i) => (
                  <Step key={i} text={x} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="man-roles" data-testid="manual-roles">
        <h2 id="man-roles" className="man-h2 px-1">
          {m.roles.title}
        </h2>
        <p className="man-p px-1">{m.roles.intro}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r} className={`man-card man-rolecard${r === role ? ' me' : ''}`} data-testid="manual-rolecard" data-role={r}>
              <b className="man-title">{m.roles[r].name}</b>
              <p className="man-p">{rich(m.roles[r].summary)}</p>
              <ul className="man-list">
                {m.roles[r].can.map((x, i) => (
                  <li key={i}>{rich(x)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`man-g-${g.id}`} className="flex flex-col gap-3" data-testid="manual-group" data-group={g.id}>
          <h2 id={`man-g-${g.id}`} className="man-h2 px-1">
            {g.title}
          </h2>
          {g.sections.map((s) => (
            <SectionCard key={s.id} id={s.id} s={s.section} howtos={s.howtos} m={m} customer={g.id === 'customer'} />
          ))}
          <a href="#manual-top" className="btn-ghost btn-sm self-start">
            <ArrowUp className="size-4" aria-hidden />
            {m.labels.backToTop}
          </a>
        </section>
      ))}
    </div>
  )
}
