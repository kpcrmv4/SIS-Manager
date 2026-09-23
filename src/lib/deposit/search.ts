/**
 * A search term typed by a user can contain `,` or `)` — both are PostgREST or-list
 * delimiters, so an unquoted term silently widens the filter (CLAUDE.md §6). Every
 * `.or()` built from user input goes through this.
 */
export function likeTerm(column: string, raw: string): string {
  const value = `%${raw}%`.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `${column}.ilike."${value}"`
}

export function searchOr(columns: string[], raw: string): string {
  return columns.map((c) => likeTerm(c, raw)).join(',')
}
