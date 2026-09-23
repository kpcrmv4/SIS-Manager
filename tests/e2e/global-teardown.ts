import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adminDb } from './fixtures/db'
import { AUTH_DIR } from './fixtures/env'
import { parkFixture } from './fixtures/users'

/** Switch the fixture accounts and branches off between runs (setup turns them back on). */
export default async function globalTeardown() {
  const file = join(AUTH_DIR, 'fixture.json')
  if (!existsSync(file)) return
  const { users } = JSON.parse(readFileSync(file, 'utf8')) as { users: Record<string, string> }
  await parkFixture(adminDb(), users)
}
