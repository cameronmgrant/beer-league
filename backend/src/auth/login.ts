import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { users } from '../db/schema.js'
import { hashPassword, verifyPassword } from './password.js'
import type { SessionUser } from './sessions.js'

// Checked against when the username does not exist, so that "no such user"
// takes as long as "wrong password" and the response time gives nothing away.
const dummyHash = hashPassword(randomBytes(16).toString('hex'))

export async function authenticate(
  db: Db,
  username: string,
  password: string,
): Promise<SessionUser | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, username.trim().toLowerCase()))

  const matches = await verifyPassword(
    row?.passwordHash ?? (await dummyHash),
    password,
  )
  if (!row || !matches) return undefined

  return { id: row.id, username: row.username, timeZone: row.timeZone }
}
