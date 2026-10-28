import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createPost, type NewPost, type Post } from './create-post.js'
import { deletePost } from './delete-post.js'
import { reconcileCounts } from './reconcile.js'
import { beerPosts, dailyCounts, users } from '../db/schema.js'
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
    .values({ username, passwordHash: 'hash', timeZone: 'America/New_York' })
    .returning()
  if (!user) throw new Error('insert returned no row')
  return user
}

function newPost(userId: number, localDate: string): NewPost {
  return {
    userId,
    imageKey: 'img.jpg',
    thumbKey: 'thumb.jpg',
    consumedAt: new Date('2026-01-15T14:42:10Z'),
    timeSource: 'exif',
    timeZone: 'America/New_York',
    localDate,
  }
}

async function addPosts(
  userId: number,
  localDate: string,
  times = 1,
): Promise<Post[]> {
  const posts: Post[] = []
  for (let i = 0; i < times; i++) {
    posts.push(await createPost(db, newPost(userId, localDate)))
  }
  return posts
}

// A tiny repeatable random number generator (mulberry32). The same seed always
// produces the same sequence, so a failing run can be reproduced exactly.
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('nothing to pick')
  return item
}

describe('reconcileCounts: healthy data', () => {
  it('reports nothing for an empty database', async () => {
    expect(await reconcileCounts(db)).toEqual([])
  })

  it('reports nothing after posts are created', async () => {
    const alice = await addUser('alice')
    const bob = await addUser('bob')
    await addPosts(alice.id, '2026-01-15', 3)
    await addPosts(alice.id, '2026-01-16')
    await addPosts(bob.id, '2026-01-15', 2)

    expect(await reconcileCounts(db)).toEqual([])
  })

  it('reports nothing after posts are deleted, even when a day drops to zero', async () => {
    const user = await addUser('alice')
    const emptied = await addPosts(user.id, '2026-01-15', 2)
    await addPosts(user.id, '2026-01-16')

    for (const post of emptied) {
      await deletePost(db, { postId: post.id, userId: user.id })
    }

    expect(await reconcileCounts(db)).toEqual([])
  })

  it('treats a zero count with no posts as consistent', async () => {
    const user = await addUser('alice')
    await db
      .insert(dailyCounts)
      .values({ userId: user.id, localDate: '2026-01-15', count: 0 })

    expect(await reconcileCounts(db)).toEqual([])
  })
})

describe('reconcileCounts: corrupted data', () => {
  it('detects a count that is too high', async () => {
    const user = await addUser('alice')
    await addPosts(user.id, '2026-01-15', 2)
    await db.update(dailyCounts).set({ count: sql`${dailyCounts.count} + 1` })

    expect(await reconcileCounts(db)).toEqual([
      { userId: user.id, localDate: '2026-01-15', stored: 3, actual: 2 },
    ])
  })

  it('detects a count that is too low', async () => {
    const user = await addUser('alice')
    await addPosts(user.id, '2026-01-15', 2)
    await db.update(dailyCounts).set({ count: sql`${dailyCounts.count} - 1` })

    expect(await reconcileCounts(db)).toEqual([
      { userId: user.id, localDate: '2026-01-15', stored: 1, actual: 2 },
    ])
  })

  it('detects a missing count row', async () => {
    const user = await addUser('alice')
    await addPosts(user.id, '2026-01-15', 2)
    await db.delete(dailyCounts)

    expect(await reconcileCounts(db)).toEqual([
      { userId: user.id, localDate: '2026-01-15', stored: 0, actual: 2 },
    ])
  })

  it('detects a count row with no posts behind it', async () => {
    const user = await addUser('alice')
    await db
      .insert(dailyCounts)
      .values({ userId: user.id, localDate: '2026-01-15', count: 2 })

    expect(await reconcileCounts(db)).toEqual([
      { userId: user.id, localDate: '2026-01-15', stored: 2, actual: 0 },
    ])
  })

  it('detects a post marked deleted without its count being lowered', async () => {
    const user = await addUser('alice')
    const posts = await addPosts(user.id, '2026-01-15', 2)
    const [first] = posts
    if (!first) throw new Error('no post created')
    await db
      .update(beerPosts)
      .set({ deletedAt: new Date() })
      .where(eq(beerPosts.id, first.id))

    expect(await reconcileCounts(db)).toEqual([
      { userId: user.id, localDate: '2026-01-15', stored: 2, actual: 1 },
    ])
  })

  it('reports every problem, ordered by user and then day', async () => {
    const alice = await addUser('alice')
    const bob = await addUser('bob')
    await addPosts(alice.id, '2026-01-16')
    await addPosts(alice.id, '2026-01-15')
    await addPosts(bob.id, '2026-01-15')
    await db.update(dailyCounts).set({ count: sql`${dailyCounts.count} + 1` })

    expect(await reconcileCounts(db)).toEqual([
      { userId: alice.id, localDate: '2026-01-15', stored: 2, actual: 1 },
      { userId: alice.id, localDate: '2026-01-16', stored: 2, actual: 1 },
      { userId: bob.id, localDate: '2026-01-15', stored: 2, actual: 1 },
    ])
  })
})

describe('reconcileCounts: under load', () => {
  it('stays consistent after a seeded random mix of creates and deletes', async () => {
    const random = seeded(2026)
    const people = await Promise.all(
      ['alice', 'bob', 'carol'].map((name) => addUser(name)),
    )
    const dates = ['2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17']
    const live: Post[] = []

    for (let round = 1; round <= 5; round++) {
      const created = await Promise.all(
        Array.from({ length: 8 }, () =>
          createPost(db, newPost(pick(people, random).id, pick(dates, random))),
        ),
      )
      live.push(...created)

      const doomed: Post[] = []
      for (let i = 0; i < 4 && live.length > 0; i++) {
        const [removed] = live.splice(Math.floor(random() * live.length), 1)
        if (removed) doomed.push(removed)
      }
      await Promise.all(
        doomed.map((post) =>
          deletePost(db, { postId: post.id, userId: post.userId }),
        ),
      )

      expect(await reconcileCounts(db), `after round ${round}`).toEqual([])
    }
  })

  it('never raises a false alarm while posts are being made', async () => {
    const user = await addUser('alice')
    const creating = Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        createPost(
          db,
          newPost(user.id, i % 2 === 0 ? '2026-01-14' : '2026-01-15'),
        ),
      ),
    )

    const reports: unknown[] = []
    for (let i = 0; i < 20; i++) {
      reports.push(...(await reconcileCounts(db)))
    }
    await creating

    expect(reports).toEqual([])
  })
})
