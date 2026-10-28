import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPost, type NewPost, type Post } from './create-post.js'
import { deletePost } from './delete-post.js'
import { getLeaderboard, getUserCounts, type LeaderboardRow } from './counts.js'
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

function summary(rows: LeaderboardRow[]) {
  return rows.map(({ username, count, rank }) => ({ username, count, rank }))
}

describe('getUserCounts', () => {
  it('is all zeros for a user with no posts', async () => {
    const user = await addUser('alice')
    expect(await getUserCounts(db, user.id, '2026-01-15')).toEqual({
      day: 0,
      month: 0,
      year: 0,
    })
  })

  it('totals the day, month and year around the given day', async () => {
    const user = await addUser('alice')
    await addPosts(user.id, '2025-12-31')
    await addPosts(user.id, '2026-01-15', 2)
    await addPosts(user.id, '2026-01-20')
    await addPosts(user.id, '2026-02-03')

    expect(await getUserCounts(db, user.id, '2026-01-15')).toEqual({
      day: 2,
      month: 3,
      year: 4,
    })
  })

  it('splits cleanly at the end of a month', async () => {
    const user = await addUser('alice')
    await addPosts(user.id, '2026-01-31')
    await addPosts(user.id, '2026-02-01')

    expect(await getUserCounts(db, user.id, '2026-01-31')).toEqual({
      day: 1,
      month: 1,
      year: 2,
    })
    expect(await getUserCounts(db, user.id, '2026-02-01')).toEqual({
      day: 1,
      month: 1,
      year: 2,
    })
  })

  it('splits cleanly at the end of a year', async () => {
    const user = await addUser('alice')
    await addPosts(user.id, '2025-12-31')
    await addPosts(user.id, '2026-01-01')

    expect(await getUserCounts(db, user.id, '2025-12-31')).toEqual({
      day: 1,
      month: 1,
      year: 1,
    })
    expect(await getUserCounts(db, user.id, '2026-01-01')).toEqual({
      day: 1,
      month: 1,
      year: 1,
    })
  })

  it("ignores other users' posts", async () => {
    const alice = await addUser('alice')
    const bob = await addUser('bob')
    await addPosts(alice.id, '2026-01-15', 2)
    await addPosts(bob.id, '2026-01-15', 5)

    expect(await getUserCounts(db, alice.id, '2026-01-15')).toEqual({
      day: 2,
      month: 2,
      year: 2,
    })
  })

  it('does not count deleted posts', async () => {
    const user = await addUser('alice')
    const posts = await addPosts(user.id, '2026-01-15', 3)
    const [first] = posts
    if (!first) throw new Error('no post created')

    await deletePost(db, { postId: first.id, userId: user.id })

    expect(await getUserCounts(db, user.id, '2026-01-15')).toEqual({
      day: 2,
      month: 2,
      year: 2,
    })
  })

  it('rejects a badly formed date', async () => {
    const user = await addUser('alice')
    await expect(getUserCounts(db, user.id, '15/01/2026')).rejects.toThrow(
      'Invalid date',
    )
  })
})

async function seedLeaderboard() {
  const alice = await addUser('alice')
  const bob = await addUser('bob')
  const carol = await addUser('carol')
  await addUser('dave') // never posts
  const alicePosts = await addPosts(alice.id, '2026-01-15', 3)
  await addPosts(bob.id, '2026-01-15')
  await addPosts(bob.id, '2026-01-20')
  await addPosts(carol.id, '2026-01-15')
  return { alice, alicePosts }
}

describe('getLeaderboard', () => {
  it('ranks the day, with ties sharing a rank and people with zero included', async () => {
    await seedLeaderboard()

    expect(summary(await getLeaderboard(db, 'day', '2026-01-15'))).toEqual([
      { username: 'alice', count: 3, rank: 1 },
      { username: 'bob', count: 1, rank: 2 },
      { username: 'carol', count: 1, rank: 2 },
      { username: 'dave', count: 0, rank: 4 },
    ])
  })

  it('ranks the month', async () => {
    await seedLeaderboard()

    expect(summary(await getLeaderboard(db, 'month', '2026-01-15'))).toEqual([
      { username: 'alice', count: 3, rank: 1 },
      { username: 'bob', count: 2, rank: 2 },
      { username: 'carol', count: 1, rank: 3 },
      { username: 'dave', count: 0, rank: 4 },
    ])
  })

  it('ranks the year', async () => {
    await seedLeaderboard()

    expect(summary(await getLeaderboard(db, 'year', '2026-06-01'))).toEqual([
      { username: 'alice', count: 3, rank: 1 },
      { username: 'bob', count: 2, rank: 2 },
      { username: 'carol', count: 1, rank: 3 },
      { username: 'dave', count: 0, rank: 4 },
    ])
  })

  it('shows everyone at zero, tied for first, when nobody posted in the period', async () => {
    await seedLeaderboard()

    expect(summary(await getLeaderboard(db, 'month', '2026-03-01'))).toEqual([
      { username: 'alice', count: 0, rank: 1 },
      { username: 'bob', count: 0, rank: 1 },
      { username: 'carol', count: 0, rank: 1 },
      { username: 'dave', count: 0, rank: 1 },
    ])
  })

  it('does not count deleted posts', async () => {
    const { alice, alicePosts } = await seedLeaderboard()
    const [first] = alicePosts
    if (!first) throw new Error('no post created')
    await deletePost(db, { postId: first.id, userId: alice.id })

    expect(summary(await getLeaderboard(db, 'day', '2026-01-15'))).toEqual([
      { username: 'alice', count: 2, rank: 1 },
      { username: 'bob', count: 1, rank: 2 },
      { username: 'carol', count: 1, rank: 2 },
      { username: 'dave', count: 0, rank: 4 },
    ])
  })

  it('returns real numbers, not text', async () => {
    await seedLeaderboard()
    const rows = await getLeaderboard(db, 'day', '2026-01-15')

    expect(typeof rows[0]?.count).toBe('number')
    expect(typeof rows[0]?.userId).toBe('number')
  })
})
