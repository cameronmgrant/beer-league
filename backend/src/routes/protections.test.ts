import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createSession } from '../auth/sessions.js'
import { sessionTokenFrom } from '../test/api-helpers.js'
import { addUser } from '../test/factories.js'
import { createTestApp } from '../test/test-app.js'
import { resetTables } from '../test/test-db.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const urls = {
  login: '/api/v1/auth/login',
  register: '/api/v1/auth/register',
  logout: '/api/v1/auth/logout',
  me: '/api/v1/auth/me',
  health: '/api/v1/health',
}

const open: TestApp[] = []

async function appWith(
  options: Parameters<typeof createTestApp>[1],
): Promise<TestApp> {
  const ctx = await createTestApp(undefined, options)
  open.push(ctx)
  return ctx
}

beforeAll(async () => {
  const ctx = await appWith({})
  await resetTables(ctx.db)
})

beforeEach(async () => {
  const [first] = open
  if (first) await resetTables(first.db)
})

afterEach(async () => {
  while (open.length > 1) await open.pop()?.close()
})

// A request that fails validation straight away: quick, and still counted by the limit.
function attempt(
  ctx: TestApp,
  url: string,
  extra: { remoteAddress?: string; headers?: Record<string, string> } = {},
) {
  return ctx.app.inject({ method: 'POST', url, payload: {}, ...extra })
}

describe('rate limiting', () => {
  const limit = { authRateLimit: { max: 3, windowSeconds: 60 } }

  it('allows the permitted number of attempts, then answers 429', async () => {
    const ctx = await appWith(limit)

    const statuses: number[] = []
    for (let i = 0; i < 5; i++)
      statuses.push((await attempt(ctx, urls.login)).statusCode)

    expect(statuses).toEqual([400, 400, 400, 429, 429])
  })

  it('answers in the standard shape and says when to try again', async () => {
    const ctx = await appWith(limit)
    for (let i = 0; i < 3; i++) await attempt(ctx, urls.login)

    const res = await attempt(ctx, urls.login)

    expect(res.statusCode).toBe(429)
    expect(res.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many attempts. Please wait a moment and try again.',
      },
    })
    const retryAfter = Number(res.headers['retry-after'])
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('gives sign-up and login a budget each', async () => {
    const ctx = await appWith(limit)

    for (let i = 0; i < 3; i++) await attempt(ctx, urls.login)

    expect((await attempt(ctx, urls.login)).statusCode).toBe(429)
    expect((await attempt(ctx, urls.register)).statusCode).toBe(400) // its own budget is untouched

    await attempt(ctx, urls.register)
    await attempt(ctx, urls.register)
    expect((await attempt(ctx, urls.register)).statusCode).toBe(429)
  })

  it('leaves every other route alone', async () => {
    const ctx = await appWith(limit)
    for (let i = 0; i < 4; i++) await attempt(ctx, urls.login)

    expect(
      (await ctx.app.inject({ method: 'GET', url: urls.health })).statusCode,
    ).toBe(200)
    expect(
      (await ctx.app.inject({ method: 'GET', url: urls.me })).statusCode,
    ).toBe(401)
  })

  it('gives each client address its own budget', async () => {
    const ctx = await appWith(limit)
    for (let i = 0; i < 4; i++)
      await attempt(ctx, urls.login, { remoteAddress: '10.0.0.1' })

    expect(
      (await attempt(ctx, urls.login, { remoteAddress: '10.0.0.1' }))
        .statusCode,
    ).toBe(429)
    expect(
      (await attempt(ctx, urls.login, { remoteAddress: '10.0.0.2' }))
        .statusCode,
    ).toBe(400)
  })

  it('lets attempts through again once the time window has passed', async () => {
    const ctx = await appWith({ authRateLimit: { max: 2, windowSeconds: 1 } })
    await attempt(ctx, urls.login)
    await attempt(ctx, urls.login)
    expect((await attempt(ctx, urls.login)).statusCode).toBe(429)

    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect((await attempt(ctx, urls.login)).statusCode).toBe(400)
  })
})

describe('rate limiting behind a proxy', () => {
  const limit = { max: 3, windowSeconds: 60 }

  it('cannot be dodged with a forged forwarding header when no proxy is trusted', async () => {
    const ctx = await appWith({ authRateLimit: limit, trustProxyHops: 0 })

    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await attempt(ctx, urls.login, {
        headers: { 'x-forwarded-for': `9.9.9.${i}` },
      })
      statuses.push(res.statusCode)
    }

    expect(statuses).toEqual([400, 400, 400, 429, 429])
  })

  it('tells real clients apart by the forwarded address when one proxy is trusted', async () => {
    const ctx = await appWith({ authRateLimit: limit, trustProxyHops: 1 })
    const from = (ip: string) =>
      attempt(ctx, urls.login, { headers: { 'x-forwarded-for': ip } })

    for (let i = 0; i < 3; i++) await from('1.1.1.1')

    expect((await from('1.1.1.1')).statusCode).toBe(429)
    expect((await from('2.2.2.2')).statusCode).toBe(400)
  })
})

describe('origin checks', () => {
  const allowedOrigins = ['https://beerleague.example', 'http://localhost:5173']
  const post = (
    ctx: TestApp,
    url: string,
    headers: Record<string, string>,
    token?: string,
  ) =>
    ctx.app.inject({
      method: 'POST',
      url,
      payload: {},
      headers,
      ...(token === undefined ? {} : { cookies: { session: token } }),
    })

  it.each(allowedOrigins)(
    'lets a change from %s through to the handler',
    async (origin) => {
      const ctx = await appWith({ allowedOrigins })

      const res = await post(ctx, urls.login, { origin })

      expect(res.statusCode).toBe(400) // reached the handler, which found the empty body invalid
    },
  )

  it.each([
    ['another site', 'https://evil.example'],
    ['a lookalike host', 'https://beerleague.example.evil.com'],
    ['the wrong scheme', 'http://beerleague.example'],
    ['the wrong port', 'https://beerleague.example:8443'],
    ['the opaque origin', 'null'],
  ])('refuses a change from %s with 403', async (_name, origin) => {
    const ctx = await appWith({ allowedOrigins })

    const res = await post(ctx, urls.login, { origin })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({
      error: {
        code: 'forbidden_origin',
        message: 'This request came from an origin that is not allowed',
      },
    })
  })

  it('does not carry out a forged logout', async () => {
    const ctx = await appWith({ allowedOrigins })
    const user = await addUser(ctx.db, 'alice')
    const { token } = await createSession(ctx.db, user.id)

    const forged = await post(
      ctx,
      urls.logout,
      { origin: 'https://evil.example' },
      token,
    )
    const check = await ctx.app.inject({
      method: 'GET',
      url: urls.me,
      cookies: { session: token },
    })

    expect(forged.statusCode).toBe(403)
    expect(check.statusCode).toBe(200) // the session is still alive
  })

  it('does not set a session when a login comes from a foreign origin', async () => {
    const ctx = await appWith({ allowedOrigins })

    const res = await post(ctx, urls.login, { origin: 'https://evil.example' })

    expect(sessionTokenFrom(res)).toBeUndefined()
  })

  it('lets scripts and tools through, since they send neither header', async () => {
    const ctx = await appWith({ allowedOrigins })

    expect((await post(ctx, urls.login, {})).statusCode).toBe(400)
  })

  it('judges a request with only a fetch-site header by that header', async () => {
    const ctx = await appWith({ allowedOrigins })

    expect(
      (await post(ctx, urls.login, { 'sec-fetch-site': 'same-origin' }))
        .statusCode,
    ).toBe(400)
    expect(
      (await post(ctx, urls.login, { 'sec-fetch-site': 'cross-site' }))
        .statusCode,
    ).toBe(403)
  })

  it('never blocks reads, whatever the origin', async () => {
    const ctx = await appWith({ allowedOrigins })

    const res = await ctx.app.inject({
      method: 'GET',
      url: urls.health,
      headers: { origin: 'https://evil.example' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('refuses every origin when none are configured', async () => {
    const ctx = await appWith({})

    expect(
      (await post(ctx, urls.login, { origin: 'https://beerleague.example' }))
        .statusCode,
    ).toBe(403)
  })
})

describe('OpenAPI spec', () => {
  it('documents the new failure responses', async () => {
    const ctx = await appWith({})
    const spec = (
      await ctx.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    ).json()
    const codes = (path: string) => Object.keys(spec.paths[path].post.responses)

    expect(codes('/api/v1/auth/register')).toEqual(
      expect.arrayContaining(['403', '429']),
    )
    expect(codes('/api/v1/auth/login')).toEqual(
      expect.arrayContaining(['403', '429']),
    )
    expect(codes('/api/v1/auth/logout')).toEqual(
      expect.arrayContaining(['403']),
    )
  })
})
describe('proxy setting', () => {
  const ipOf = async (
    options: Parameters<typeof createTestApp>[1],
    forwarded: string,
  ) => {
    const ctx = await createTestApp((app) => {
      app.get('/test/ip', async (request) => ({ ip: request.ip }))
    }, options)
    open.push(ctx)
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/test/ip',
      headers: { 'x-forwarded-for': forwarded },
    })
    return res.json().ip
  }

  it('ignores the forwarded address when no proxy is trusted', async () => {
    expect(await ipOf({ trustProxyHops: 0 }, '1.1.1.1')).toBe('127.0.0.1')
  })

  it('uses the forwarded address when one proxy is trusted', async () => {
    expect(await ipOf({ trustProxyHops: 1 }, '1.1.1.1')).toBe('1.1.1.1')
  })

  it('uses the address the trusted proxy added, not one the client supplied', async () => {
    expect(await ipOf({ trustProxyHops: 1 }, '6.6.6.6, 1.1.1.1')).toBe(
      '1.1.1.1',
    )
  })
})
