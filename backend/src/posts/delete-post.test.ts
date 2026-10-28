import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createPost, type NewPost } from './create-post.js'
import { deletePost } from './delete-post.js'
import { beerPosts, dailyCounts, users } from '../db/schema.js'
import { createTestDb, resetTables } from '../test/test-db.js'

const { db, pool } = createTestDb()

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

async function findPost(id: number) {
  const [row] = await db.select().from(beerPosts).where(eq(beerPosts.id, id))
  return row
}

describe('deletePost', () => {
  it('marks the post deleted and takes one off that day', async () => {
    const user = await addUser()
    const post = await createPost(db, newPost(user.id))

    const result = await deletePost(db, { postId: post.id, userId: user.id })

    expect(result).toMatchObject({ ok: true, post: { id: post.id } })
    expect((await findPost(post.id))?.deletedAt).toBeInstanceOf(Date)
    expect(await countFor(user.id, '2026-01-15')).toBe(0)
  })

  it('takes off exactly one when there are several posts', async () => {
    const user = await addUser()
    const first = await createPost(db, newPost(user.id))
    await createPost(db, newPost(user.id))
    await createPost(db, newPost(user.id))

    await deletePost(db, { postId: first.id, userId: user.id })

    expect(await countFor(user.id, '2026-01-15')).toBe(2)
  })

  it("takes the count off the post's own day", async () => {
    const user = await addUser()
    const older = await createPost(
      db,
      newPost(user.id, { localDate: '2026-01-14' }),
    )
    await createPost(db, newPost(user.id, { localDate: '2026-01-15' }))

    await deletePost(db, { postId: older.id, userId: user.id })

    expect(await countFor(user.id, '2026-01-14')).toBe(0)
    expect(await countFor(user.id, '2026-01-15')).toBe(1)
  })

  it("leaves other users' counts alone", async () => {
    const alice = await addUser('alice')
    const bob = await addUser('bob')
    const alicePost = await createPost(db, newPost(alice.id))
    await createPost(db, newPost(bob.id))

    await deletePost(db, { postId: alicePost.id, userId: alice.id })

    expect(await countFor(alice.id, '2026-01-15')).toBe(0)
    expect(await countFor(bob.id, '2026-01-15')).toBe(1)
  })

  it('does nothing the second time the same post is deleted', async () => {
    const user = await addUser()
    const target = await createPost(db, newPost(user.id))
    await createPost(db, newPost(user.id))

    const first = await deletePost(db, { postId: target.id, userId: user.id })
    const second = await deletePost(db, { postId: target.id, userId: user.id })

    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, reason: 'not_found' })
    expect(await countFor(user.id, '2026-01-15')).toBe(1)
  })

  it("refuses to delete someone else's post", async () => {
    const alice = await addUser('alice')
    const bob = await addUser('bob')
    const post = await createPost(db, newPost(alice.id))

    const result = await deletePost(db, { postId: post.id, userId: bob.id })

    expect(result).toEqual({ ok: false, reason: 'forbidden' })
    expect((await findPost(post.id))?.deletedAt).toBeNull()
    expect(await countFor(alice.id, '2026-01-15')).toBe(1)
  })

  it('reports a post that does not exist', async () => {
    const user = await addUser()
    await createPost(db, newPost(user.id))

    const result = await deletePost(db, { postId: 999999, userId: user.id })

    expect(result).toEqual({ ok: false, reason: 'not_found' })
    expect(await countFor(user.id, '2026-01-15')).toBe(1)
  })

  it('takes one off only once when the same post is deleted at the same time', async () => {
    const user = await addUser()
    const target = await createPost(db, newPost(user.id))
    await createPost(db, newPost(user.id))

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        deletePost(db, { postId: target.id, userId: user.id }),
      ),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(
      results.filter((r) => !r.ok && r.reason === 'not_found'),
    ).toHaveLength(4)
    expect(await countFor(user.id, '2026-01-15')).toBe(1)
  })

  it('counts correctly when many different posts are deleted at the same time', async () => {
    const user = await addUser()
    const posts = await Promise.all(
      Array.from({ length: 10 }, () => createPost(db, newPost(user.id))),
    )

    await Promise.all(
      posts.map((p) => deletePost(db, { postId: p.id, userId: user.id })),
    )

    expect(await countFor(user.id, '2026-01-15')).toBe(0)
  })

  it('rolls the delete back when the count row is missing', async () => {
    const user = await addUser()
    const post = await createPost(db, newPost(user.id))
    await db.delete(dailyCounts) // simulate corrupted data

    await expect(
      deletePost(db, { postId: post.id, userId: user.id }),
    ).rejects.toThrow('daily count')

    expect((await findPost(post.id))?.deletedAt).toBeNull()
  })

  it('counts again when a new post is made after a delete', async () => {
    const user = await addUser()
    const post = await createPost(db, newPost(user.id))
    await deletePost(db, { postId: post.id, userId: user.id })

    await createPost(db, newPost(user.id))

    expect(await countFor(user.id, '2026-01-15')).toBe(1)
  })
})
