import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { hashPassword } from '../auth/password.js'
import {
  createSession,
  hashToken,
  SESSION_LIFETIME_MS,
} from '../auth/sessions.js'
import { invites, sessions, users } from '../db/schema.js'
import { sessionTokenFrom, setCookies } from '../test/api-helpers.js'
import { addInvite, addUser } from '../test/factories.js'
import { createTestApp } from '../test/test-app.js'
import { resetTables } from '../test/test-db.js'

const DAY = 24 * 60 * 60 * 1000
const password = 'correct horse battery'
const urls = {
  register: '/api/v1/auth/register',
  login: '/api/v1/auth/login',
  logout: '/api/v1/auth/logout',
  me: '/api/v1/auth/me',
}

let ctx: Awaited<ReturnType<typeof createTestApp>>

beforeAll(async () => {
  ctx = await createTestApp()
})

beforeEach(async () => {
  await resetTables(ctx.db)
})

afterAll(async () => {
  await ctx.close()
})

function get(url: string, token?: string) {
  return ctx.app.inject({
    method: 'GET',
    url,
    ...(token === undefined ? {} : { cookies: { session: token } }),
  })
}

function post(url: string, payload: object, token?: string) {
  return ctx.app.inject({
    method: 'POST',
    url,
    payload,
    ...(token === undefined ? {} : { cookies: { session: token } }),
  })
}

// A user who is already logged in, created straight in the database.
async function userWithSession(
  username = 'alice',
  createdAt: Date = new Date(),
) {
  const user = await addUser(ctx.db, username)
  const { token } = await createSession(ctx.db, user.id, createdAt)
  return { user, token }
}

const body = (inviteCode: string, overrides: Record<string, unknown> = {}) => ({
  username: 'alice',
  password,
  timeZone: 'America/New_York',
  inviteCode,
  ageConfirmed: true,
  ...overrides,
})

const freshInvite = () =>
  addInvite(ctx.db, { expiresAt: new Date(Date.now() + DAY) })

describe('GET /auth/me', () => {
  it('returns the logged-in user and nothing else', async () => {
    const { user, token } = await userWithSession('alice')

    const res = await get(urls.me, token)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      user: { id: user.id, username: 'alice', timeZone: 'America/New_York' },
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it.each([
    ['no cookie', undefined],
    ['an unknown token', 'not-a-real-token'],
  ])('answers 401 for %s', async (_name, token) => {
    const res = await get(urls.me, token)

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({
      error: { code: 'unauthenticated', message: 'Please log in' },
    })
  })

  it('answers 401 once the session has expired', async () => {
    const { token } = await userWithSession(
      'alice',
      new Date('2020-01-01T00:00:00Z'),
    )

    expect((await get(urls.me, token)).statusCode).toBe(401)
  })

  it('answers 401 once the user no longer exists', async () => {
    const { user, token } = await userWithSession('alice')
    await ctx.db.delete(users).where(eq(users.id, user.id)) // their sessions go with them

    expect((await get(urls.me, token)).statusCode).toBe(401)
  })

  it('accepts the token only from the cookie', async () => {
    const { token } = await userWithSession('alice')

    const viaHeader = await ctx.app.inject({
      method: 'GET',
      url: urls.me,
      headers: { authorization: `Bearer ${token}` },
    })
    const viaQuery = await get(`${urls.me}?session=${token}`)

    expect(viaHeader.statusCode).toBe(401)
    expect(viaQuery.statusCode).toBe(401)
  })

  it('does not touch the cookie of a recently used session', async () => {
    const { token } = await userWithSession('alice')

    expect(setCookies(await get(urls.me, token))).toEqual([])
  })

  it('renews the session and refreshes the cookie after a day of not being used', async () => {
    const { token } = await userWithSession(
      'alice',
      new Date(Date.now() - 2 * DAY),
    )
    const before = Date.now()

    const res = await get(urls.me, token)

    expect(res.statusCode).toBe(200)
    expect(sessionTokenFrom(res)).toBe(token)
    expect(setCookies(res)[0]).toContain('HttpOnly')
    const [row] = await ctx.db.select().from(sessions)
    expect(row?.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + SESSION_LIFETIME_MS,
    )
  })
})

describe('POST /auth/register: success', () => {
  it('creates the account, logs the person in, and returns only safe fields', async () => {
    const invite = await freshInvite()

    const res = await post(urls.register, body(invite.code))

    expect(res.statusCode).toBe(201)
    const { user } = res.json()
    expect(Object.keys(res.json())).toEqual(['user'])
    expect(Object.keys(user).sort()).toEqual(['id', 'timeZone', 'username'])
    expect(user).toMatchObject({
      username: 'alice',
      timeZone: 'America/New_York',
    })
    expect(res.body).not.toContain(password)
    expect(res.body).not.toContain('argon2')
    expect(res.headers['cache-control']).toBe('no-store')

    const me = await get(urls.me, sessionTokenFrom(res))
    expect(me.statusCode).toBe(200)
    expect(me.json().user).toEqual(user)
  })

  it('sends the session in a cookie that page scripts cannot read, valid for 30 days', async () => {
    const invite = await freshInvite()

    const res = await post(urls.register, body(invite.code))

    const cookie = setCookies(res).find((c) => c.startsWith('session=')) ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
    const expires = new Date(
      /Expires=([^;]+)/.exec(cookie)?.[1] ?? '',
    ).getTime()
    expect(expires).toBeGreaterThan(Date.now() + 29 * DAY)
    expect(expires).toBeLessThanOrEqual(Date.now() + 31 * DAY)
  })

  it('adds the Secure flag when the app is configured for HTTPS', async () => {
    const secure = await createTestApp(undefined, { cookieSecure: true })
    const invite = await freshInvite()

    const res = await secure.app.inject({
      method: 'POST',
      url: urls.register,
      payload: body(invite.code),
    })
    await secure.close()

    expect(res.statusCode).toBe(201)
    expect(setCookies(res).find((c) => c.startsWith('session='))).toContain(
      'Secure',
    )
  })

  it('stores only a hash of the session token', async () => {
    const invite = await freshInvite()

    const res = await post(urls.register, body(invite.code))

    const token = sessionTokenFrom(res) ?? ''
    const [row] = await ctx.db.select().from(sessions)
    expect(row?.tokenHash).toBe(hashToken(token))
    expect(row?.tokenHash).not.toBe(token)
  })

  it('treats usernames as case-insensitive and ignores surrounding spaces', async () => {
    const invite = await freshInvite()

    const res = await post(
      urls.register,
      body(invite.code, { username: '  Alice ' }),
    )

    expect(res.statusCode).toBe(201)
    expect(res.json().user.username).toBe('alice')
    const [row] = await ctx.db.select().from(users)
    expect(row?.username).toBe('alice')
  })
})
describe('POST /auth/register: rejections', () => {
  it.each([
    ['a username that is too short', { username: 'ab' }],
    ['a username that is too long', { username: 'a'.repeat(21) }],
    ['a username with a space', { username: 'bad name' }],
    ['a username with a dash', { username: 'no-dashes' }],
    ['an empty username', { username: '' }],
    ['a username of the wrong type', { username: 12345 }],
    ['a password that is too short', { password: 'x'.repeat(9) }],
    ['a password that is too long', { password: 'x'.repeat(129) }],
    ['a missing age confirmation', { ageConfirmed: undefined }],
    ['an age confirmation of false', { ageConfirmed: false }],
    ['an age confirmation that is text', { ageConfirmed: 'true' }],
    ['an invalid time zone', { timeZone: 'Not/AZone' }],
    ['an empty invite code', { inviteCode: '' }],
  ])('rejects %s with 400 and creates nothing', async (_name, overrides) => {
    const invite = await freshInvite()

    const res = await post(urls.register, body(invite.code, overrides))

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
    expect(setCookies(res)).toEqual([])
    expect(await ctx.db.select().from(users)).toHaveLength(0)
    const [row] = await ctx.db
      .select()
      .from(invites)
      .where(eq(invites.code, invite.code))
    expect(row?.usedAt).toBeNull()
  })

  it('answers every kind of bad invite the same way, so codes cannot be probed', async () => {
    const used = await addInvite(ctx.db, {
      expiresAt: new Date(Date.now() + DAY),
      usedAt: new Date(),
    })
    const expired = await addInvite(ctx.db, {
      expiresAt: new Date(Date.now() - DAY),
    })

    const unknownResult = await post(urls.register, body('no-such-code'))
    const usedResult = await post(urls.register, body(used.code))
    const expiredResult = await post(urls.register, body(expired.code))

    for (const res of [unknownResult, usedResult, expiredResult]) {
      expect(res.statusCode).toBe(422)
      expect(setCookies(res)).toEqual([])
    }
    expect(unknownResult.json()).toEqual({
      error: {
        code: 'invalid_invite',
        message: 'That invite code is not valid',
      },
    })
    expect(usedResult.json()).toEqual(unknownResult.json())
    expect(expiredResult.json()).toEqual(unknownResult.json())
    expect(await ctx.db.select().from(users)).toHaveLength(0)
  })

  it('reports a taken username without using up the invite', async () => {
    await addUser(ctx.db, 'alice')
    const invite = await freshInvite()

    const res = await post(urls.register, body(invite.code))

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('username_taken')
    expect(setCookies(res)).toEqual([])

    const retry = await post(
      urls.register,
      body(invite.code, { username: 'bob' }),
    )
    expect(retry.statusCode).toBe(201)
  })

  it('does not reveal which usernames exist to someone with a bad invite', async () => {
    await addUser(ctx.db, 'alice')

    const res = await post(urls.register, body('no-such-code'))

    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('invalid_invite')
  })
})
describe('POST /auth/login', () => {
  async function aliceWithPassword() {
    return addUser(ctx.db, 'alice', {
      passwordHash: await hashPassword(password),
    })
  }

  it('logs in with the right credentials', async () => {
    const alice = await aliceWithPassword()

    const res = await post(urls.login, { username: 'alice', password })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      user: { id: alice.id, username: 'alice', timeZone: 'America/New_York' },
    })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).not.toContain('argon2')
    expect((await get(urls.me, sessionTokenFrom(res))).statusCode).toBe(200)
  })

  it.each(['Alice', 'ALICE', '  alice  '])(
    'ignores case and spaces in the username "%s"',
    async (typed) => {
      await aliceWithPassword()

      const res = await post(urls.login, { username: typed, password })

      expect(res.statusCode).toBe(200)
    },
  )

  it('gives the same answer for a wrong password and an unknown user', async () => {
    await aliceWithPassword()

    const wrongPassword = await post(urls.login, {
      username: 'alice',
      password: 'wrong password',
    })
    const unknownUser = await post(urls.login, { username: 'nobody', password })

    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownUser.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual({
      error: {
        code: 'invalid_credentials',
        message: 'Wrong username or password',
      },
    })
    expect(unknownUser.json()).toEqual(wrongPassword.json())
    expect(setCookies(wrongPassword)).toEqual([])
    expect(setCookies(unknownUser)).toEqual([])
  })

  it.each([
    ['a missing password', { username: 'alice' }],
    ['an empty username', { username: '', password }],
    [
      'a password over the length limit',
      { username: 'alice', password: 'x'.repeat(129) },
    ],
    ['a username of the wrong type', { username: 5, password }],
  ])('rejects %s with 400', async (_name, payload) => {
    await aliceWithPassword()

    const res = await post(urls.login, payload)

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
    expect(setCookies(res)).toEqual([])
  })

  it('starts a separate session each time, and both work', async () => {
    await aliceWithPassword()

    const first = sessionTokenFrom(
      await post(urls.login, { username: 'alice', password }),
    )
    const second = sessionTokenFrom(
      await post(urls.login, { username: 'alice', password }),
    )

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toBe(second)
    expect((await get(urls.me, first)).statusCode).toBe(200)
    expect((await get(urls.me, second)).statusCode).toBe(200)
  })
})
describe('POST /auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    const { token } = await userWithSession('alice')

    const res = await post(urls.logout, {}, token)

    expect(res.statusCode).toBe(204)
    const cleared = setCookies(res).find((c) => c.startsWith('session=;'))
    expect(cleared).toBeDefined()
    expect((await get(urls.me, token)).statusCode).toBe(401)
    expect(await ctx.db.select().from(sessions)).toHaveLength(0)
  })

  it('ends only the session it was called with', async () => {
    const { user, token } = await userWithSession('alice')
    const { token: other } = await createSession(ctx.db, user.id).then(
      (session) => session,
    )

    await post(urls.logout, {}, token)

    expect((await get(urls.me, token)).statusCode).toBe(401)
    expect((await get(urls.me, other)).statusCode).toBe(200)
  })

  it.each([
    ['no session at all', undefined],
    ['a cookie that is not a real session', 'not-a-real-token'],
  ])('still succeeds with %s', async (_name, token) => {
    const res = await post(urls.logout, {}, token)

    expect(res.statusCode).toBe(204)
  })
})

describe('a full visit', () => {
  it('registers, uses the session, logs out, and logs back in', async () => {
    const invite = await freshInvite()
    const registered = await post(urls.register, body(invite.code))
    const first = sessionTokenFrom(registered)
    expect((await get(urls.me, first)).statusCode).toBe(200)

    expect((await post(urls.logout, {}, first)).statusCode).toBe(204)
    expect((await get(urls.me, first)).statusCode).toBe(401)

    const loggedIn = await post(urls.login, { username: 'alice', password })
    const second = sessionTokenFrom(loggedIn)
    expect(second).not.toBe(first)
    expect((await get(urls.me, second)).statusCode).toBe(200)
  })
})
describe('OpenAPI spec', () => {
  it('documents the auth routes and the errors they can return', async () => {
    const spec = (await get('/api/v1/openapi.json')).json()
    const codes = (path: string, method: string) =>
      Object.keys(spec.paths[path][method].responses)

    expect(codes('/api/v1/auth/register', 'post')).toEqual(
      expect.arrayContaining(['201', '400', '409', '422']),
    )
    expect(codes('/api/v1/auth/login', 'post')).toEqual(
      expect.arrayContaining(['200', '400', '401']),
    )
    expect(codes('/api/v1/auth/me', 'get')).toEqual(
      expect.arrayContaining(['200', '401']),
    )
    expect(spec.paths['/api/v1/auth/logout'].post).toBeDefined()
  })
})
