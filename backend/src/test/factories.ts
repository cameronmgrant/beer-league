import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.js'
import { invites, users } from '../db/schema.js'

export async function addUser(
  db: Db,
  username = 'alice',
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const [user] = await db
    .insert(users)
    .values({
      username,
      passwordHash: 'hash',
      timeZone: 'America/New_York',
      ...overrides,
    })
    .returning()
  if (!user) throw new Error('insert returned no row')
  return user
}

export async function addInvite(
  db: Db,
  overrides: Partial<typeof invites.$inferInsert> = {},
) {
  const [invite] = await db
    .insert(invites)
    .values({
      code: randomUUID(),
      expiresAt: new Date('2026-02-01T00:00:00Z'),
      ...overrides,
    })
    .returning()
  if (!invite) throw new Error('insert returned no row')
  return invite
}
