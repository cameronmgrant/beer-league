import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { generateInviteCode, createInvites } from './invites.js'
import { registerUser } from './register.js'
import { invites, users } from '../db/schema.js'
import { createTestDb, resetTables } from '../test/test-db.js'

const { db, pool } = createTestDb()
const now = new Date('2026-01-15T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

beforeEach(async () => {
  await resetTables(db)
})

afterAll(async () => {
  await pool.end()
})

describe('generateInviteCode', () => {
  it('makes codes like abcd-efgh-jkmn without easily confused characters', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateInviteCode()).toMatch(
        /^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){2}$/,
      )
    }
  })

  it('does not repeat', () => {
    const codes = Array.from({ length: 2000 }, () => generateInviteCode())

    expect(new Set(codes).size).toBe(2000)
  })
})

describe('createInvites', () => {
  it('stores the requested number of unused invites that expire after the given days', async () => {
    const created = await createInvites(db, { count: 3, days: 14 }, now)

    const rows = await db.select().from(invites)
    expect(rows).toHaveLength(3)
    expect(new Set(created.map((invite) => invite.code))).toEqual(
      new Set(rows.map((row) => row.code)),
    )
    for (const row of rows) {
      expect(row).toMatchObject({ createdBy: null, usedBy: null, usedAt: null })
      expect(row.expiresAt).toEqual(new Date(now.getTime() + 14 * DAY))
    }
  })

  it('returns the codes and expiry so they can be shown', async () => {
    const created = await createInvites(db, { count: 2, days: 7 }, now)

    expect(created).toHaveLength(2)
    for (const invite of created) {
      expect(invite.code).toMatch(
        /^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){2}$/,
      )
      expect(invite.expiresAt).toEqual(new Date(now.getTime() + 7 * DAY))
    }
  })

  it.each([[{ count: 1, days: 1 }], [{ count: 100, days: 90 }]])(
    'accepts the limits %j',
    async (input) => {
      const created = await createInvites(db, input, now)

      expect(created).toHaveLength(input.count)
    },
  )

  it.each([
    ['no invites', { count: 0, days: 14 }],
    ['too many invites', { count: 101, days: 14 }],
    ['a fractional count', { count: 1.5, days: 14 }],
    ['a count that is not a number', { count: Number.NaN, days: 14 }],
    ['no days', { count: 1, days: 0 }],
    ['too many days', { count: 1, days: 91 }],
    ['a fractional number of days', { count: 1, days: 1.5 }],
    ['a number of days that is not a number', { count: 1, days: Number.NaN }],
  ])('refuses %s and creates nothing', async (_name, input) => {
    await expect(createInvites(db, input, now)).rejects.toThrow(RangeError)

    expect(await db.select().from(invites)).toHaveLength(0)
  })

  it('makes invites that really work for signing up', async () => {
    const [invite] = await createInvites(db, { count: 1, days: 14 }, now)
    if (!invite) throw new Error('no invite created')

    const result = await registerUser(
      db,
      {
        username: 'alice',
        password: 'correct horse battery',
        timeZone: 'America/New_York',
        inviteCode: invite.code,
        ageConfirmed: true,
      },
      now,
    )

    expect(result.ok).toBe(true)
    expect(await db.select().from(users)).toHaveLength(1)
  })
})
