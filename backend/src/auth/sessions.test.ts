import { afterAll, beforeEach, describe, expect, it } from 'vitest'
// import { eq } from 'drizzle-orm'
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findSession,
  generateToken,
  hashToken,
  SESSION_EXTEND_AFTER_MS,
  SESSION_LIFETIME_MS,
} from './sessions.js'
import { sessions } from '../db/schema.js'
import { addUser } from '../test/factories.js'
import { createTestDb, resetTables } from '../test/test-db.js'

const { db, pool } = createTestDb()
const now = new Date('2026-01-15T12:00:00Z')
const after = (ms: number) => new Date(now.getTime() + ms)

beforeEach(async () => {
  await resetTables(db)
})

afterAll(async () => {
  await pool.end()
})

describe('tokens', () => {
  it('makes long, URL-safe, unique tokens', () => {
    const tokens = Array.from({ length: 1000 }, () => generateToken())

    expect(new Set(tokens).size).toBe(1000)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('hashes a token to 64 hex characters, the same way every time', () => {
    const token = generateToken()

    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).not.toBe(token)
    expect(hashToken(token)).not.toBe(hashToken(generateToken()))
  })
})

describe('createSession', () => {
  it('stores only a hash of the token, expiring in 30 days', async () => {
    const user = await addUser(db)
    const { token, expiresAt } = await createSession(db, user.id, now)

    const rows = await db.select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(rows)).not.toContain(token)
    expect(expiresAt).toEqual(after(SESSION_LIFETIME_MS))
    expect(rows[0]?.expiresAt).toEqual(expiresAt)
  })

  it('lets one user be signed in on several devices', async () => {
    const user = await addUser(db)
    const first = await createSession(db, user.id, now)
    const second = await createSession(db, user.id, now)

    expect(first.token).not.toBe(second.token)
    expect(await findSession(db, first.token, now)).toBeDefined()
    expect(await findSession(db, second.token, now)).toBeDefined()
  })
})

describe('findSession', () => {
  it('finds the user behind a valid token, without the password hash', async () => {
    const user = await addUser(db, 'alice', {
      passwordHash: 'secret-hash-value',
    })
    const { token, expiresAt } = await createSession(db, user.id, now)

    const found = await findSession(db, token, now)

    expect(found).toEqual({
      user: { id: user.id, username: 'alice', timeZone: 'America/New_York' },
      expiresAt,
      extended: false,
    })
    expect(JSON.stringify(found)).not.toContain('secret-hash-value')
  })

  it.each([
    ['an unknown token', 'not-a-real-token'],
    ['an empty token', ''],
    ['the stored hash used as a token', 'HASH'],
  ])('does not find %s', async (_name, attempt) => {
    const user = await addUser(db)
    const { token } = await createSession(db, user.id, now)
    const tokenToTry = attempt === 'HASH' ? hashToken(token) : attempt

    expect(await findSession(db, tokenToTry, now)).toBeUndefined()
  })

  it('stops working at the moment it expires, and not a millisecond sooner', async () => {
    const user = await addUser(db)
    const { token: justBefore } = await createSession(db, user.id, now)
    const { token: atExpiry } = await createSession(db, user.id, now)

    expect(
      await findSession(db, justBefore, after(SESSION_LIFETIME_MS - 1)),
    ).toBeDefined()
    expect(
      await findSession(db, atExpiry, after(SESSION_LIFETIME_MS)),
    ).toBeUndefined()
  })

  it('leaves a recently used session alone', async () => {
    const user = await addUser(db)
    const { token, expiresAt } = await createSession(db, user.id, now)

    const found = await findSession(db, token, after(SESSION_EXTEND_AFTER_MS))

    expect(found?.extended).toBe(false)
    expect(found?.expiresAt).toEqual(expiresAt)
    const [row] = await db.select().from(sessions)
    expect(row?.expiresAt).toEqual(expiresAt)
  })

  it('extends a session used more than a day after it was last extended', async () => {
    const user = await addUser(db)
    const { token } = await createSession(db, user.id, now)
    const later = after(SESSION_EXTEND_AFTER_MS + 1)

    const found = await findSession(db, token, later)

    const newExpiry = new Date(later.getTime() + SESSION_LIFETIME_MS)
    expect(found?.extended).toBe(true)
    expect(found?.expiresAt).toEqual(newExpiry)
    const [row] = await db.select().from(sessions)
    expect(row?.expiresAt).toEqual(newExpiry)
  })

  it('stays valid past its original expiry when it keeps being used', async () => {
    const user = await addUser(db)
    const { token } = await createSession(db, user.id, now)

    await findSession(db, token, after(2 * SESSION_EXTEND_AFTER_MS)) // extends

    const pastOriginalExpiry = after(
      SESSION_LIFETIME_MS + SESSION_EXTEND_AFTER_MS,
    )
    expect(await findSession(db, token, pastOriginalExpiry)).toBeDefined()
  })
})

describe('deleteSession', () => {
  it('ends that session and only that session', async () => {
    const user = await addUser(db)
    const first = await createSession(db, user.id, now)
    const second = await createSession(db, user.id, now)

    await deleteSession(db, first.token)

    expect(await findSession(db, first.token, now)).toBeUndefined()
    expect(await findSession(db, second.token, now)).toBeDefined()
  })

  it('does nothing for an unknown token', async () => {
    await expect(deleteSession(db, 'not-a-real-token')).resolves.toBeUndefined()
  })
})

describe('deleteExpiredSessions', () => {
  it('removes expired sessions, including one expiring right now, and reports how many', async () => {
    const user = await addUser(db)
    await createSession(db, user.id, after(-SESSION_LIFETIME_MS - 1)) // long expired
    await createSession(db, user.id, after(-SESSION_LIFETIME_MS)) // expires exactly now
    const live = await createSession(db, user.id, now)

    expect(await deleteExpiredSessions(db, now)).toBe(2)

    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await findSession(db, live.token, now)).toBeDefined()
  })

  it('reports zero when there is nothing to remove', async () => {
    const user = await addUser(db)
    await createSession(db, user.id, now)

    expect(await deleteExpiredSessions(db, now)).toBe(0)
  })
})
