import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { beerPosts, dailyCounts } from '../db/schema.js'
import { InMemoryStorage, type PhotoStorage } from '../photos/storage.js'
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
  ctx.memory.clear()
})

afterAll(async () => {
  await ctx.close()
})

// A post whose two pictures really exist in storage.
async function postWithPictures(userId: number, target: TestApp = ctx) {
  const post = await addPost(target.db, userId)
  await target.memory.put(post.imageKey, Buffer.from('big'))
  await target.memory.put(post.thumbKey, Buffer.from('small'))
  return post
}

async function countOn(userId: number, localDate = '2026-01-15') {
  const [row] = await ctx.db
    .select()
    .from(dailyCounts)
    .where(eq(dailyCounts.userId, userId))
  return row?.localDate === localDate ? row.count : undefined
}

describe('DELETE /beers/:id', () => {
  it('deletes your own post: gone from the feed, counted down, pictures removed', async () => {
    const { user, token } = await member(ctx)
    const post = await postWithPictures(user.id)
    await postWithPictures(user.id)

    const res = await call(ctx, 'DELETE', `/api/v1/beers/${post.id}`, token)

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    const feed = (await call(ctx, 'GET', '/api/v1/feed', token)).json()
    expect(feed.posts.map((p: { id: number }) => p.id)).not.toContain(post.id)
    expect(await countOn(user.id)).toBe(1)
    expect(ctx.memory.keys()).not.toContain(post.imageKey)
    expect(ctx.memory.keys()).not.toContain(post.thumbKey)
    expect(ctx.memory.keys()).toHaveLength(2) // the other post's pictures are untouched
  })

  it('answers 404 the second time, and counts down only once', async () => {
    const { user, token } = await member(ctx)
    const post = await postWithPictures(user.id)
    await postWithPictures(user.id)

    const first = await call(ctx, 'DELETE', `/api/v1/beers/${post.id}`, token)
    const second = await call(ctx, 'DELETE', `/api/v1/beers/${post.id}`, token)

    expect(first.statusCode).toBe(204)
    expect(second.statusCode).toBe(404)
    expect(second.json().error.code).toBe('not_found')
    expect(await countOn(user.id)).toBe(1)
  })

  it('refuses to delete someone else\u2019s post, and changes nothing', async () => {
    const alice = await member(ctx, 'alice')
    const bob = await member(ctx, 'bob')
    const post = await postWithPictures(alice.user.id)

    const res = await call(ctx, 'DELETE', `/api/v1/beers/${post.id}`, bob.token)

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden')
    const [row] = await ctx.db
      .select()
      .from(beerPosts)
      .where(eq(beerPosts.id, post.id))
    expect(row?.deletedAt).toBeNull()
    expect(await countOn(alice.user.id)).toBe(1)
    expect(ctx.memory.keys()).toHaveLength(2)
  })

  it('answers 404 for a post that does not exist', async () => {
    const { token } = await member(ctx)

    const res = await call(ctx, 'DELETE', '/api/v1/beers/999999', token)

    expect(res.statusCode).toBe(404)
  })

  it('refuses someone who is not logged in, and changes nothing', async () => {
    const { user } = await member(ctx)
    const post = await postWithPictures(user.id)

    const res = await call(ctx, 'DELETE', `/api/v1/beers/${post.id}`)

    expect(res.statusCode).toBe(401)
    expect(await countOn(user.id)).toBe(1)
    expect(ctx.memory.keys()).toHaveLength(2)
  })

  it('refuses a request from a foreign origin, and changes nothing', async () => {
    const { user, token } = await member(ctx)
    const post = await postWithPictures(user.id)

    const res = await call(ctx, 'DELETE', `/api/v1/beers/${post.id}`, token, {
      origin: 'https://evil.example',
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden_origin')
    expect(await countOn(user.id)).toBe(1)
  })

  it.each([
    ['text', 'abc'],
    ['zero', '0'],
    ['a negative number', '-5'],
    ['a fraction', '1.5'],
    ['a number too big to be exact', '99999999999999999999'],
  ])('refuses %s as a post id with 400', async (_name, id) => {
    const { token } = await member(ctx)

    const res = await call(ctx, 'DELETE', `/api/v1/beers/${id}`, token)

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('still succeeds when the pictures cannot be removed', async () => {
    const memory = new InMemoryStorage()
    const stubborn: PhotoStorage = {
      put: (key, data) => memory.put(key, data),
      get: (key) => memory.get(key),
      delete: async () => {
        throw new Error('disk trouble')
      },
    }
    const app = await createTestApp(undefined, { storage: stubborn })
    try {
      const { user, token } = await member(app)
      const post = await addPost(app.db, user.id)

      const res = await call(app, 'DELETE', `/api/v1/beers/${post.id}`, token)

      expect(res.statusCode).toBe(204)
      const [row] = await app.db
        .select()
        .from(beerPosts)
        .where(eq(beerPosts.id, post.id))
      expect(row?.deletedAt).not.toBeNull()
    } finally {
      await app.close()
    }
  })

  it('counts down once when the same post is deleted five times at once', async () => {
    const { user, token } = await member(ctx)
    const post = await postWithPictures(user.id)
    await postWithPictures(user.id)

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(ctx, 'DELETE', `/api/v1/beers/${post.id}`, token),
      ),
    )

    expect(results.filter((res) => res.statusCode === 204)).toHaveLength(1)
    expect(results.filter((res) => res.statusCode === 404)).toHaveLength(4)
    expect(await countOn(user.id)).toBe(1)
  })
})
