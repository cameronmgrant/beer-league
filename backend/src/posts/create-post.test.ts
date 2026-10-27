import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createPost, type NewPost } from './create-post.js'
import { beerPosts, dailyCounts, users } from '../db/schema.js'
import { resolvePostTime } from '../resolve-post-time.js'
import { createTestDb, resetTables } from '../test/test-db.js'

const { db, pool } = createTestDb()
const now = new Date('2026-01-15T20:00:00Z') // 3:00 pm in New York

beforeEach(async () => {
  await resetTables(db)
})

afterAll(async () => {
  await pool.end()
})

async function addUser(username = 'alice') {
  const [user] = await db
    .insert(users)
    .values({ username, passwordHash: 'hash', timeZone: 'America/New_York' })
    .returning()
  if (!user) throw new Error('insert returned no row')
  return user
}

function newPost(userId: number, overrides: Partial<NewPost> = {}): NewPost {
  return {
    userId,
    imageKey: 'img.jpg',
    thumbKey: 'thumb.jpg',
    consumedAt: new Date('2026-01-15T14:42:10Z'),
    timeSource: 'exif',
    timeZone: 'America/New_York',
    localDate: '2026-01-15',
    ...overrides,
  }
}

// Builds a post the way the real app will: through resolvePostTime.
function resolvedPost(userId: number, exifDateTime: string): NewPost {
  const result = resolvePostTime({
    exifDateTime,
    userTimeZone: 'America/New_York',
    now,
  })
  if (!result.ok)
    throw new Error(`could not resolve the time: ${result.reason}`)
  return newPost(userId, {
    consumedAt: result.consumedAt,
    timeSource: result.timeSource,
    timeZone: result.timeZone,
    localDate: result.localDate,
  })
}

async function countFor(
  userId: number,
  localDate: string,
): Promise<number | undefined> {
  const rows = await db
    .select()
    .from(dailyCounts)
    .where(
      and(eq(dailyCounts.userId, userId), eq(dailyCounts.localDate, localDate)),
    )
  return rows[0]?.count
}

describe('createPost', () => {
  it('saves the post and starts that day at 1', async () => {
    const user = await addUser()
    const post = await createPost(
      db,
      newPost(user.id, { caption: 'First one' }),
    )

    expect(post).toMatchObject({
      userId: user.id,
      caption: 'First one',
      timeSource: 'exif',
      timeZone: 'America/New_York',
      localDate: '2026-01-15',
    })
    expect(post.deletedAt).toBeNull()
    expect(await countFor(user.id, '2026-01-15')).toBe(1)
  })

  it('stores a missing caption as null', async () => {
    const user = await addUser()
    const post = await createPost(db, newPost(user.id))
    expect(post.caption).toBeNull()
  })

  it('adds to the same day for further posts', async () => {
    const user = await addUser()
    await createPost(db, newPost(user.id))
    await createPost(db, newPost(user.id))
    await createPost(db, newPost(user.id))

    expect(await countFor(user.id, '2026-01-15')).toBe(3)
    expect(await db.select().from(beerPosts)).toHaveLength(3)
  })

  it('keeps different days separate', async () => {
    const user = await addUser()
    await createPost(db, newPost(user.id, { localDate: '2026-01-14' }))
    await createPost(db, newPost(user.id, { localDate: '2026-01-15' }))

    expect(await countFor(user.id, '2026-01-14')).toBe(1)
    expect(await countFor(user.id, '2026-01-15')).toBe(1)
  })

  it('keeps different users separate', async () => {
    const alice = await addUser('alice')
    const bob = await addUser('bob')
    await createPost(db, newPost(alice.id))
    await createPost(db, newPost(alice.id))
    await createPost(db, newPost(bob.id))

    expect(await countFor(alice.id, '2026-01-15')).toBe(2)
    expect(await countFor(bob.id, '2026-01-15')).toBe(1)
  })

  it('counts posts either side of the 5 am cutoff on different days', async () => {
    const user = await addUser()
    await createPost(db, resolvedPost(user.id, '2026:01:15 04:59:00'))
    await createPost(db, resolvedPost(user.id, '2026:01:15 05:00:00'))

    expect(await countFor(user.id, '2026-01-14')).toBe(1)
    expect(await countFor(user.id, '2026-01-15')).toBe(1)
  })

  it('counts ten simultaneous posts correctly', async () => {
    const user = await addUser()
    await Promise.all(
      Array.from({ length: 10 }, () => createPost(db, newPost(user.id))),
    )

    expect(await countFor(user.id, '2026-01-15')).toBe(10)
    expect(await db.select().from(beerPosts)).toHaveLength(10)
  })

  it('saves nothing when the count update fails', async () => {
    const user = await addUser()
    // A count already at the largest whole number the column can hold,
    // so adding one makes the count update fail.
    await db
      .insert(dailyCounts)
      .values({ userId: user.id, localDate: '2026-01-15', count: 2147483647 })

    const error = await createPost(db, newPost(user.id)).catch(
      (e: unknown) => e,
    )
    const text = `${String(error)} ${String((error as { cause?: unknown }).cause)}`

    expect(text).toContain('out of range')
    expect(await db.select().from(beerPosts)).toHaveLength(0)
    expect(await countFor(user.id, '2026-01-15')).toBe(2147483647)
  })

  it('saves nothing for a user that does not exist', async () => {
    await expect(createPost(db, newPost(999999))).rejects.toThrow()

    expect(await db.select().from(beerPosts)).toHaveLength(0)
    expect(await db.select().from(dailyCounts)).toHaveLength(0)
  })
})
