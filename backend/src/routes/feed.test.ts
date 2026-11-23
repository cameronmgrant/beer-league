import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deletePost } from '../posts/delete-post.js'
import { encodeCursor } from '../posts/feed-cursor.js'
import { addPost } from '../test/factories.js'
import { call, member, type TestApp } from '../test/members.js'
import { createTestApp } from '../test/test-app.js'
import { resetTables } from '../test/test-db.js'

let ctx: TestApp

beforeAll(async () => {
  ctx = await createTestApp()
})

beforeEach(async () => {
  await resetTables(ctx.db)
})

afterAll(async () => {
  await ctx.close()
})

// Creates posts uploaded one second apart in January 2026, oldest first.
async function seedPosts(userId: number, count: number) {
  const posts = []
  for (let i = 0; i < count; i++) {
    const post = await addPost(ctx.db, userId)
    const when = new Date(Date.UTC(2026, 0, 15, 12, 0, i)).toISOString()
    await ctx.db.execute(
      sql`UPDATE beer_posts SET created_at = ${when}::timestamptz WHERE id = ${post.id}`,
    )
    posts.push(post)
  }
  return posts
}

const newestFirst = (posts: Array<{ id: number }>) =>
  posts.map((post) => post.id).reverse()

// Reads the feed the way a client does, following the cursors to the end.
async function walk(token: string, limit: number): Promise<number[]> {
  const ids: number[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 100; guard++) {
    const query = `limit=${limit}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`
    const res = await call(ctx, 'GET', `/api/v1/feed?${query}`, token)
    const page = res.json()
    ids.push(...page.posts.map((post: { id: number }) => post.id))
    if (page.nextCursor === null) return ids
    cursor = page.nextCursor
  }
  throw new Error('paging did not finish')
}

describe('GET /feed', () => {
  it('refuses someone who is not logged in', async () => {
    const res = await call(ctx, 'GET', '/api/v1/feed')

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthenticated')
  })

  it('is empty when there are no posts', async () => {
    const { token } = await member(ctx)

    const res = await call(ctx, 'GET', '/api/v1/feed', token)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ posts: [], nextCursor: null })
  })

  it('shows posts from everyone, newest first, as post views', async () => {
    const alice = await member(ctx, 'alice')
    const bob = await member(ctx, 'bob')
    const [older, newer] = [
      await addPost(ctx.db, alice.user.id, { caption: 'First' }),
      await addPost(ctx.db, bob.user.id),
    ]
    await ctx.db.execute(
      sql`UPDATE beer_posts SET created_at = '2026-01-15T12:00:00Z' WHERE id = ${older.id}`,
    )
    await ctx.db.execute(
      sql`UPDATE beer_posts SET created_at = '2026-01-15T12:00:01Z' WHERE id = ${newer.id}`,
    )

    const res = await call(ctx, 'GET', '/api/v1/feed', alice.token)

    const { posts } = res.json()
    expect(posts.map((post: { username: string }) => post.username)).toEqual([
      'bob',
      'alice',
    ])
    expect(posts[1]).toMatchObject({
      id: older.id,
      username: 'alice',
      caption: 'First',
      localDate: '2026-01-15',
      timeZone: 'America/New_York',
      timeSource: 'exif',
      imageUrl: `/api/v1/${older.imageKey}`,
      thumbUrl: `/api/v1/${older.thumbKey}`,
    })
    expect(Object.keys(posts[1]).sort()).toEqual([
      'caption',
      'consumedAt',
      'createdAt',
      'id',
      'imageUrl',
      'localDate',
      'thumbUrl',
      'timeSource',
      'timeZone',
      'username',
    ])
  })

  it('returns 20 posts and a cursor for the rest', async () => {
    const { user, token } = await member(ctx)
    const expected = newestFirst(await seedPosts(user.id, 25))

    const first = (await call(ctx, 'GET', '/api/v1/feed', token)).json()
    expect(first.posts.map((post: { id: number }) => post.id)).toEqual(
      expected.slice(0, 20),
    )
    expect(first.nextCursor).not.toBeNull()

    const second = (
      await call(
        ctx,
        'GET',
        `/api/v1/feed?cursor=${encodeURIComponent(first.nextCursor)}`,
        token,
      )
    ).json()
    expect(second.posts.map((post: { id: number }) => post.id)).toEqual(
      expected.slice(20),
    )
    expect(second.nextCursor).toBeNull()
  })

  it.each([1, 3, 4, 10, 11])(
    'shows every post exactly once with a page size of %i',
    async (size) => {
      const { user, token } = await member(ctx)
      const expected = newestFirst(await seedPosts(user.id, 10))

      expect(await walk(token, size)).toEqual(expected)
    },
  )

  it('accepts a cursor together with a different page size', async () => {
    const { user, token } = await member(ctx)
    const expected = newestFirst(await seedPosts(user.id, 10))
    const first = (await call(ctx, 'GET', '/api/v1/feed?limit=3', token)).json()

    const next = (
      await call(
        ctx,
        'GET',
        `/api/v1/feed?limit=5&cursor=${encodeURIComponent(first.nextCursor)}`,
        token,
      )
    ).json()

    expect(next.posts.map((post: { id: number }) => post.id)).toEqual(
      expected.slice(3, 8),
    )
  })

  it('never shows deleted posts', async () => {
    const { user, token } = await member(ctx)
    const posts = await seedPosts(user.id, 4)
    const doomed = posts[1]
    if (!doomed) throw new Error('missing post')
    await deletePost(ctx.db, { postId: doomed.id, userId: user.id })

    const ids = (await call(ctx, 'GET', '/api/v1/feed', token))
      .json()
      .posts.map((post: { id: number }) => post.id)

    expect(ids).toEqual(newestFirst(posts).filter((id) => id !== doomed.id))
  })

  it.each([
    ['zero', '0'],
    ['a negative number', '-1'],
    ['more than 50', '51'],
    ['a fraction', '1.5'],
    ['text', 'many'],
    ['nothing', ''],
  ])('refuses a page size of %s with 400', async (_name, limit) => {
    const { token } = await member(ctx)

    const res = await call(ctx, 'GET', `/api/v1/feed?limit=${limit}`, token)

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it.each([
    ['text that is not a cursor', 'not-a-cursor'],
    [
      'a cursor with an impossible id',
      encodeCursor({ createdAt: '2026-01-15T12:00:00.000000Z', id: 1 }).slice(
        0,
        -3,
      ),
    ],
    ['a long string', 'x'.repeat(200)],
  ])('refuses %s with 400 invalid_cursor', async (_name, cursor) => {
    const { token } = await member(ctx)

    const res = await call(
      ctx,
      'GET',
      `/api/v1/feed?cursor=${encodeURIComponent(cursor)}`,
      token,
    )

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_cursor')
  })

  it('refuses a cursor that is too long to be real', async () => {
    const { token } = await member(ctx)

    const res = await call(
      ctx,
      'GET',
      `/api/v1/feed?cursor=${'x'.repeat(301)}`,
      token,
    )

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('is not cached, and never contains password data', async () => {
    const { user, token } = await member(ctx)
    await addPost(ctx.db, user.id)

    const res = await call(ctx, 'GET', '/api/v1/feed', token)

    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).not.toMatch(/passwordHash|password_hash|argon2/i)
  })
})
