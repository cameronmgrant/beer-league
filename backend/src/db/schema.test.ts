import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { beerPosts, dailyCounts, users } from './schema.js'
import { createTestDb, resetTables } from '../test/test-db.js'

const { db, pool } = createTestDb()

beforeEach(async () => {
  await resetTables(db)
})

afterAll(async () => {
  await pool.end()
})

// Runs a query that should fail, and returns the name of the rule it broke.
async function violatedConstraint(
  query: PromiseLike<unknown>,
): Promise<string | undefined> {
  try {
    await query
  } catch (error) {
    const source = (error as { cause?: unknown }).cause ?? error
    return (source as { constraint?: string }).constraint
  }
  return undefined
}

async function addUser(username = 'alice') {
  const [user] = await db
    .insert(users)
    .values({ username, passwordHash: 'hash', timeZone: 'America/New_York' })
    .returning()
  if (!user) throw new Error('insert returned no row')
  return user
}

function validPost(userId: number) {
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

describe('database', () => {
  it('connects', async () => {
    const result = await db.execute(sql`SELECT 1 AS ok`)
    expect(result.rows[0]).toEqual({ ok: 1 })
  })

  it('has all four tables', async () => {
    const result = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    const names = result.rows.map((row) => row.table_name)
    expect(names).toEqual(
      expect.arrayContaining([
        'users',
        'invites',
        'beer_posts',
        'daily_counts',
      ]),
    )
  })

  it('empties every table when reset', async () => {
    const user = await addUser()
    await db.insert(beerPosts).values(validPost(user.id))
    await resetTables(db)
    expect(await db.select().from(users)).toHaveLength(0)
    expect(await db.select().from(beerPosts)).toHaveLength(0)
  })
})

describe('database rules', () => {
  it('accepts a valid post', async () => {
    const user = await addUser()
    await db.insert(beerPosts).values(validPost(user.id))
    expect(await db.select().from(beerPosts)).toHaveLength(1)
  })

  it('rejects a duplicate username', async () => {
    await addUser('alice')
    const rule = await violatedConstraint(addUser('alice'))
    expect(rule).toBe('users_username_unique')
  })

  it('rejects a post for a user that does not exist', async () => {
    const rule = await violatedConstraint(
      db.insert(beerPosts).values(validPost(999999)),
    )
    expect(rule).toBe('beer_posts_user_id_users_id_fk')
  })

  it('rejects an unknown time source', async () => {
    const user = await addUser()
    const rule = await violatedConstraint(
      db
        .insert(beerPosts)
        .values({ ...validPost(user.id), timeSource: 'upload' }),
    )
    expect(rule).toBe('time_source_valid')
  })

  it('rejects a caption longer than 140 characters', async () => {
    const user = await addUser()
    const rule = await violatedConstraint(
      db
        .insert(beerPosts)
        .values({ ...validPost(user.id), caption: 'x'.repeat(141) }),
    )
    expect(rule).toBe('caption_length')
  })

  it('rejects a negative daily count', async () => {
    const user = await addUser()
    const rule = await violatedConstraint(
      db
        .insert(dailyCounts)
        .values({ userId: user.id, localDate: '2026-01-15', count: -1 }),
    )
    expect(rule).toBe('count_non_negative')
  })
})
