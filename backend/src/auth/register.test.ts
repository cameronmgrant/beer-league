import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, isNull } from 'drizzle-orm'
import { registerUser, type RegisterInput } from './register.js'
import { invites, users } from '../db/schema.js'
import { addInvite, addUser } from '../test/factories.js'
import { createTestDb, resetTables } from '../test/test-db.js'

const { db, pool } = createTestDb()
const now = new Date('2026-01-15T12:00:00Z')

beforeEach(async () => {
  await resetTables(db)
})

afterAll(async () => {
  await pool.end()
})

function input(
  inviteCode: string,
  overrides: Partial<RegisterInput> = {},
): RegisterInput {
  return {
    username: 'alice',
    password: 'correct horse battery',
    timeZone: 'America/New_York',
    inviteCode,
    ageConfirmed: true,
    ...overrides,
  }
}

async function inviteRow(code: string) {
  const [row] = await db.select().from(invites).where(eq(invites.code, code))
  return row
}

describe('registerUser: success', () => {
  it('creates the user and uses up the invite', async () => {
    const invite = await addInvite(db)

    const result = await registerUser(db, input(invite.code), now)

    expect(result).toMatchObject({
      ok: true,
      user: { username: 'alice', timeZone: 'America/New_York' },
    })
    const [stored] = await db.select().from(users)
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/)
    expect(stored?.passwordHash).not.toContain('correct horse')
    expect(stored?.ageConfirmedAt).toEqual(now)
    expect(await inviteRow(invite.code)).toMatchObject({
      usedBy: stored?.id,
      usedAt: now,
    })
  })

  it('returns only safe fields', async () => {
    const invite = await addInvite(db)

    const result = await registerUser(db, input(invite.code), now)

    expect(result.ok && Object.keys(result.user).sort()).toEqual([
      'id',
      'timeZone',
      'username',
    ])
  })

  it('accepts an invite that expires a moment from now', async () => {
    const invite = await addInvite(db, {
      expiresAt: new Date(now.getTime() + 1),
    })

    expect((await registerUser(db, input(invite.code), now)).ok).toBe(true)
  })
})

describe('registerUser: invites', () => {
  it.each([
    ['already used', { usedAt: new Date('2026-01-10T00:00:00Z') }],
    ['expired a moment ago', { expiresAt: new Date(now.getTime() - 1) }],
    ['expiring this very moment', { expiresAt: now }],
  ])('rejects an invite that is %s', async (_name, overrides) => {
    const invite = await addInvite(db, overrides)

    const result = await registerUser(db, input(invite.code), now)

    expect(result).toEqual({ ok: false, reason: 'invalid_invite' })
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it.each([
    ['an unknown code', 'no-such-code'],
    ['an empty code', ''],
  ])('rejects %s', async (_name, code) => {
    expect(await registerUser(db, input(code), now)).toEqual({
      ok: false,
      reason: 'invalid_invite',
    })
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it('does not let one invite be used twice', async () => {
    const invite = await addInvite(db)
    await registerUser(db, input(invite.code), now)

    const second = await registerUser(
      db,
      input(invite.code, { username: 'bob' }),
      now,
    )

    expect(second).toEqual({ ok: false, reason: 'invalid_invite' })
    expect(await db.select().from(users)).toHaveLength(1)
  })
})

describe('registerUser: usernames', () => {
  it('reports a taken username and keeps the invite for another try', async () => {
    const first = await addInvite(db)
    const second = await addInvite(db)
    await registerUser(db, input(first.code), now)

    const clash = await registerUser(db, input(second.code), now)

    expect(clash).toEqual({ ok: false, reason: 'username_taken' })
    expect(await inviteRow(second.code)).toMatchObject({
      usedAt: null,
      usedBy: null,
    })

    const retry = await registerUser(
      db,
      input(second.code, { username: 'bob' }),
      now,
    )
    expect(retry.ok).toBe(true)
  })

  it('does not reveal which usernames exist to someone without a valid invite', async () => {
    await addUser(db, 'alice')

    const result = await registerUser(db, input('no-such-code'), now)

    expect(result).toEqual({ ok: false, reason: 'invalid_invite' })
  })

  it('leaves everything untouched when the username breaks the format rule', async () => {
    const invite = await addInvite(db)

    await expect(
      registerUser(db, input(invite.code, { username: 'Not Allowed' }), now),
    ).rejects.toThrow()

    expect(await db.select().from(users)).toHaveLength(0)
    expect(await inviteRow(invite.code)).toMatchObject({
      usedAt: null,
      usedBy: null,
    })
  })
})

describe('registerUser: bad input and races', () => {
  it('refuses an invalid time zone and changes nothing', async () => {
    const invite = await addInvite(db)

    await expect(
      registerUser(db, input(invite.code, { timeZone: 'Not/AZone' }), now),
    ).rejects.toThrow('Invalid time zone')

    expect(await db.select().from(users)).toHaveLength(0)
    expect(await inviteRow(invite.code)).toMatchObject({ usedAt: null })
  })

  it('lets only one of several simultaneous sign-ups use the same invite', async () => {
    const invite = await addInvite(db)
    const names = ['a_one', 'a_two', 'a_three', 'a_four', 'a_five']

    const results = await Promise.all(
      names.map((username) =>
        registerUser(db, input(invite.code, { username }), now),
      ),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(
      results.filter((r) => !r.ok && r.reason === 'invalid_invite'),
    ).toHaveLength(4)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('lets only one of two simultaneous sign-ups take the same username', async () => {
    const first = await addInvite(db)
    const second = await addInvite(db)

    const results = await Promise.all([
      registerUser(db, input(first.code), now),
      registerUser(db, input(second.code), now),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(
      results.filter((r) => !r.ok && r.reason === 'username_taken'),
    ).toHaveLength(1)
    expect(
      await db.select().from(invites).where(isNull(invites.usedAt)),
    ).toHaveLength(1)
  })
})
