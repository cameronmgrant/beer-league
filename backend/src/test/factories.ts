import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.js'
import { invites, users } from '../db/schema.js'
import { newPhotoKeys } from '../photos/storage.js'
import { createPost, type NewPost } from '../posts/create-post.js'

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

// A post saved the proper way (so the daily count moves too), with fresh picture keys.
export async function addPost(
  db: Db,
  userId: number,
  overrides: Partial<NewPost> = {},
) {
  const keys = newPhotoKeys()
  return createPost(db, {
    userId,
    imageKey: keys.imageKey,
    thumbKey: keys.thumbKey,
    consumedAt: new Date('2026-01-15T14:42:10Z'),
    timeSource: 'exif',
    timeZone: 'America/New_York',
    localDate: '2026-01-15',
    ...overrides,
  })
}
