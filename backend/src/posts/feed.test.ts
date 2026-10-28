import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPost, type NewPost, type Post } from './create-post.js'
import { deletePost } from './delete-post.js'
import { InvalidCursorError } from './feed-cursor.js'
import { getFeed } from './feed.js'
import { users } from '../db/schema.js'
import { createTestDb, resetTables } from '../test/test-db.js'

const { db, pool } = createTestDb()

beforeEach(async () => {
  await resetTables(db)
})

afterAll(async () => {
  await pool.end()
})

async function addUser(username: string) {
  const [user] = await db
    .insert(users)
    .values({
      username,
      passwordHash: 'secret-hash',
      timeZone: 'America/New_York',
    })
    .returning()
  if (!user) throw new Error('insert returned no row')
  return user
}

function newPost(userId: number): NewPost {
  return {
    userId,
    imageKey: 'img.jpg',
    thumbKey: 'thumb.jpg',
    consumedAt: new Date('2026-01-15T14:42:10Z'),
    timeSource: 'exif',
    timeZone: 'America/New_York',
    localDate: '2026-01-15',
  }
}

// Gives a post an exact upload time, so tests control the order.
async function setCreatedAt(postId: number, iso: string): Promise<void> {
  await db.execute(
    sql`UPDATE beer_posts SET created_at = ${iso}::timestamptz WHERE id = ${postId}`,
  )
}

// Creates posts one after another, with the default (current) upload time.
async function addPosts(userId: number, times: number): Promise<Post[]> {
  const posts: Post[] = []
  for (let i = 0; i < times; i++) {
    posts.push(await createPost(db, newPost(userId)))
  }
  return posts
}

// Creates posts uploaded one second apart in January 2026, oldest first.
// Anything made with addPosts later is newer than all of these.
async function seedPosts(userId: number, count: number): Promise<Post[]> {
  const posts = await addPosts(userId, count)
  for (const [i, post] of posts.entries()) {
    await setCreatedAt(
      post.id,
      new Date(Date.UTC(2026, 0, 15, 12, 0, i)).toISOString(),
    )
  }
  return posts
}

// Follows the cursors from the top to the end and returns every id, in order.
async function walk(pageSize: number): Promise<number[]> {
  const ids: number[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 100; guard++) {
    const page = await getFeed(db, { limit: pageSize, cursor })
    ids.push(...page.posts.map((post) => post.id))
    if (page.nextCursor === null) return ids
    cursor = page.nextCursor
  }
  throw new Error('paging did not finish')
}

const newestFirst = (posts: Post[]) => posts.map((post) => post.id).reverse()

describe('getFeed', () => {
  it('is empty when there are no posts', async () => {
    expect(await getFeed(db)).toEqual({ posts: [], nextCursor: null })
  })

  it('shows the newest post first, with its author', async () => {
    const alice = await addUser('alice')
    const bob = await addUser('bob')
    const first = await createPost(db, newPost(alice.id))
    const second = await createPost(db, newPost(bob.id))
    await setCreatedAt(first.id, '2026-01-15T12:00:00.000Z')
    await setCreatedAt(second.id, '2026-01-15T12:00:01.000Z')

    const page = await getFeed(db)

    expect(page.posts.map((post) => post.username)).toEqual(['bob', 'alice'])
    expect(page.posts[0]).toMatchObject({
      id: second.id,
      username: 'bob',
      imageKey: 'img.jpg',
      thumbKey: 'thumb.jpg',
      localDate: '2026-01-15',
    })
    expect(page.posts[0]?.createdAt).toBeInstanceOf(Date)
  })

  it('never includes anyone password hash', async () => {
    const user = await addUser('alice')
    await addPosts(user.id, 1)

    const page = await getFeed(db)

    expect(page.posts[0]).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(page)).not.toContain('secret-hash')
  })

  it('returns 20 posts by default and a cursor for the rest', async () => {
    const user = await addUser('alice')
    const posts = await seedPosts(user.id, 25)
    const expected = newestFirst(posts)

    const first = await getFeed(db)
    expect(first.posts.map((post) => post.id)).toEqual(expected.slice(0, 20))
    expect(first.nextCursor).not.toBeNull()

    const second = await getFeed(db, { cursor: first.nextCursor ?? undefined })
    expect(second.posts.map((post) => post.id)).toEqual(expected.slice(20))
    expect(second.nextCursor).toBeNull()
  })

  it('gives no cursor when the posts exactly fill the page', async () => {
    const user = await addUser('alice')
    await seedPosts(user.id, 3)

    const page = await getFeed(db, { limit: 3 })

    expect(page.posts).toHaveLength(3)
    expect(page.nextCursor).toBeNull()
  })

  it.each([1, 3, 4, 10, 11])(
    'shows every post exactly once with a page size of %i',
    async (size) => {
      const user = await addUser('alice')
      const posts = await seedPosts(user.id, 10)

      expect(await walk(size)).toEqual(newestFirst(posts))
    },
  )

  it('never shows deleted posts', async () => {
    const user = await addUser('alice')
    const posts = await seedPosts(user.id, 6)
    const [, second, , , fifth] = posts
    if (!second || !fifth) throw new Error('posts missing')
    await deletePost(db, { postId: second.id, userId: user.id })
    await deletePost(db, { postId: fifth.id, userId: user.id })

    const seen = await walk(2)

    expect(seen).toEqual(
      newestFirst(posts).filter((id) => id !== second.id && id !== fifth.id),
    )
  })
})

describe('getFeed while the data changes', () => {
  it('keeps paging steady when new posts arrive mid-scroll', async () => {
    const user = await addUser('alice')
    const posts = await seedPosts(user.id, 8)
    const expected = newestFirst(posts)

    const first = await getFeed(db, { limit: 3 })
    expect(first.posts.map((post) => post.id)).toEqual(expected.slice(0, 3))

    const fresh = await addPosts(user.id, 2) // new posts arrive while the user scrolls

    const second = await getFeed(db, {
      limit: 3,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.posts.map((post) => post.id)).toEqual(expected.slice(3, 6))

    const third = await getFeed(db, {
      limit: 3,
      cursor: second.nextCursor ?? undefined,
    })
    expect(third.posts.map((post) => post.id)).toEqual(expected.slice(6))

    const top = await getFeed(db, { limit: 2 }) // a refresh shows them at the top
    expect(top.posts.map((post) => post.id)).toEqual(newestFirst(fresh))
  })

  it('keeps paging steady when the post at the bookmark is deleted', async () => {
    const user = await addUser('alice')
    const posts = await seedPosts(user.id, 8)
    const expected = newestFirst(posts)
    const first = await getFeed(db, { limit: 3 })
    const bookmarked = expected[2]
    if (bookmarked === undefined) throw new Error('missing post')

    await deletePost(db, { postId: bookmarked, userId: user.id })

    const second = await getFeed(db, {
      limit: 3,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.posts.map((post) => post.id)).toEqual(expected.slice(3, 6))
  })

  it('leaves out a post deleted before the scroll reaches it', async () => {
    const user = await addUser('alice')
    const posts = await seedPosts(user.id, 8)
    const expected = newestFirst(posts)
    const first = await getFeed(db, { limit: 3 })
    const unseen = expected[4]
    if (unseen === undefined) throw new Error('missing post')

    await deletePost(db, { postId: unseen, userId: user.id })

    const second = await getFeed(db, {
      limit: 3,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.posts.map((post) => post.id)).toEqual([
      expected[3],
      expected[5],
      expected[6],
    ])
    const third = await getFeed(db, {
      limit: 3,
      cursor: second.nextCursor ?? undefined,
    })
    expect(third.posts.map((post) => post.id)).toEqual([expected[7]])
  })

  it('uses the id to order posts uploaded at the same instant', async () => {
    const user = await addUser('alice')
    const posts = await addPosts(user.id, 5)
    for (const post of posts)
      await setCreatedAt(post.id, '2026-01-15T12:00:00.000Z')

    const expected = posts.map((post) => post.id).sort((a, b) => b - a)

    expect(await walk(2)).toEqual(expected)
  })

  it('pages correctly when upload times differ by less than a millisecond', async () => {
    const user = await addUser('alice')
    const [p0, p1, p2, p3] = await addPosts(user.id, 4)
    if (!p0 || !p1 || !p2 || !p3) throw new Error('posts missing')
    await setCreatedAt(p0.id, '2026-01-15T12:00:00.123456Z')
    await setCreatedAt(p1.id, '2026-01-15T12:00:00.123457Z')
    await setCreatedAt(p2.id, '2026-01-15T12:00:00.123999Z')
    await setCreatedAt(p3.id, '2026-01-15T12:00:00.123000Z')

    const expected = [p2.id, p1.id, p0.id, p3.id]

    expect(await walk(1)).toEqual(expected)
    expect(await walk(2)).toEqual(expected)
  })

  it('never shows a post twice or loses an old one while posts are being created', async () => {
    const user = await addUser('alice')
    const old = await seedPosts(user.id, 12)
    const creating = Promise.all(
      Array.from({ length: 30 }, () => createPost(db, newPost(user.id))),
    )

    const seen = await walk(4)
    await creating

    expect(new Set(seen).size).toBe(seen.length)
    for (const post of old) expect(seen).toContain(post.id)
  })
})

describe('getFeed input checks', () => {
  it.each([0, -1, 1.5, 51, Number.NaN])(
    'rejects a page size of %s',
    async (limit) => {
      await expect(getFeed(db, { limit })).rejects.toThrow(RangeError)
    },
  )

  it('rejects a cursor that is not valid', async () => {
    await expect(getFeed(db, { cursor: 'not a cursor' })).rejects.toThrow(
      InvalidCursorError,
    )
  })
})
