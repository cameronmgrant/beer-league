import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { authenticate } from './login.js'
import { hashPassword } from './password.js'
import { registerUser } from './register.js'
import { addInvite, addUser } from '../test/factories.js'
import { createTestDb, resetTables } from '../test/test-db.js'

const { db, pool } = createTestDb()
const password = 'correct horse battery'

beforeEach(async () => {
  await resetTables(db)
})

afterAll(async () => {
  await pool.end()
})

async function addUserWithPassword(username: string, plain: string) {
  return addUser(db, username, { passwordHash: await hashPassword(plain) })
}

describe('authenticate', () => {
  it('returns the user for the right username and password, without the hash', async () => {
    const user = await addUserWithPassword('alice', password)

    const result = await authenticate(db, 'alice', password)

    expect(result).toEqual({
      id: user.id,
      username: 'alice',
      timeZone: 'America/New_York',
    })
  })

  it.each(['Alice', 'ALICE', '  alice  '])(
    'ignores case and spaces in the username "%s"',
    async (typed) => {
      await addUserWithPassword('alice', password)

      expect(await authenticate(db, typed, password)).toMatchObject({
        username: 'alice',
      })
    },
  )

  it.each([
    ['the wrong password', 'wrong password'],
    ['an empty password', ''],
    ['the right password in the wrong case', 'CORRECT HORSE BATTERY'],
    ['the right password with an extra space', `${password} `],
  ])('refuses %s', async (_name, attempt) => {
    await addUserWithPassword('alice', password)

    expect(await authenticate(db, 'alice', attempt)).toBeUndefined()
  })

  it('refuses a username that does not exist', async () => {
    await addUserWithPassword('alice', password)

    expect(await authenticate(db, 'nobody', password)).toBeUndefined()
  })

  it('does not accept the stored hash as the password', async () => {
    const user = await addUserWithPassword('alice', password)

    expect(await authenticate(db, 'alice', user.passwordHash)).toBeUndefined()
  })

  it('lets someone who just registered log in', async () => {
    const invite = await addInvite(db, {
      expiresAt: new Date(Date.now() + 60_000),
    })
    const registered = await registerUser(db, {
      username: 'bob',
      password,
      timeZone: 'Europe/London',
      inviteCode: invite.code,
      ageConfirmed: true,
    })

    expect(registered.ok).toBe(true)
    expect(await authenticate(db, 'Bob', password)).toMatchObject({
      username: 'bob',
      timeZone: 'Europe/London',
    })
  })
})
