import type { HTTPMethods } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { multipartBody } from './test/api-helpers.js'
import { call, member, type TestApp } from './test/members.js'
import { plainJpeg } from './test/photos.js'
import { createTestApp } from './test/test-app.js'
import { resetTables } from './test/test-db.js'
import { addPost } from './test/factories.js'

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

const request = (
  method: HTTPMethods,
  url: string,
  extra: Record<string, unknown> = {},
) => ctx.app.inject({ method, url, ...extra })

const login = (payload: string, contentType?: string) =>
  request('POST', '/api/v1/auth/login', {
    payload,
    headers: contentType === undefined ? {} : { 'content-type': contentType },
  })

describe('security headers', () => {
  const answers: Array<[string, HTTPMethods, string]> = [
    ['a successful answer', 'GET', '/api/v1/health'],
    ['a login refusal', 'GET', '/api/v1/auth/me'],
    ['an unknown address in the API', 'GET', '/api/v1/nope'],
    ['an unknown address outside the API', 'GET', '/nope'],
    ['a wrong method', 'PUT', '/api/v1/auth/login'],
    ['the API description', 'GET', '/api/v1/openapi.json'],
  ]

  it.each(answers)('are on %s', async (_name, method, url) => {
    const res = await request(method, url)

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site')
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'none'",
    )
    expect(res.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    )
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('are on a refusal of a bad request body too', async () => {
    const res = await login('{bad', 'application/json')

    expect(res.statusCode).toBe(400)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
  })

  it('are on photos, which keep their own long private caching', async () => {
    const { token } = await member(ctx)
    const name = '0123456789abcdef0123456789abcdef.jpg'
    await ctx.memory.put(`photos/${name}`, await plainJpeg())

    const res = await call(ctx, 'GET', `/api/v1/photos/${name}`, token)

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable',
    )
  })

  it('include strict transport security only when the site is served over HTTPS', async () => {
    const secure = await createTestApp(undefined, { cookieSecure: true })
    try {
      const withHttps = await secure.app.inject({
        method: 'GET',
        url: '/api/v1/health',
      })
      const without = await request('GET', '/api/v1/health')

      expect(withHttps.headers['strict-transport-security']).toContain(
        'max-age=15552000',
      )
      expect(without.headers['strict-transport-security']).toBeUndefined()
    } finally {
      await secure.close()
    }
  })
})

describe('request bodies', () => {
  it.each([
    ['plain text', 'hello', 'text/plain'],
    [
      'a web form',
      'username=a&password=b',
      'application/x-www-form-urlencoded',
    ],
    ['XML', '<login/>', 'application/xml'],
    ['JSON with no content type', '{"username":"a","password":"b"}', undefined],
  ])('refuses %s with 415', async (_name, payload, contentType) => {
    const res = await login(payload, contentType)

    expect(res.statusCode).toBe(415)
    expect(res.json().error.code).toBe('unsupported_media_type')
  })

  it.each([
    ['an empty list', '[]'],
    ['null', 'null'],
    ['a string', '"text"'],
    ['a number', '123'],
    ['true', 'true'],
  ])('refuses JSON that is %s with 400', async (_name, payload) => {
    const res = await login(payload, 'application/json')

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it.each([
    ['broken JSON', '{bad'],
    ['JSON with a trailing comma', '{"username":"a",}'],
    ['an empty body', ''],
    [
      'a poisoned object',
      '{"__proto__":{"admin":true},"username":"a","password":"b"}',
    ],
  ])('refuses %s with 400', async (_name, payload) => {
    const res = await login(payload, 'application/json')

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
  })

  it('refuses a JSON body over 64 KiB with 413', async () => {
    const res = await login(
      JSON.stringify({ username: 'a', password: 'x'.repeat(70_000) }),
      'application/json',
    )

    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('payload_too_large')
  })

  it('still accepts a photo upload bigger than the JSON limit', async () => {
    const { token } = await member(ctx)
    const padded = Buffer.concat([await plainJpeg(), Buffer.alloc(300_000)])
    const body = multipartBody([
      { name: 'photo', data: padded },
      {
        name: 'manualTime',
        value: new Date(Date.now() - 3_600_000).toISOString(),
      },
    ])

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/beers',
      payload: body.payload,
      headers: body.headers,
      cookies: { session: token },
    })

    expect(res.statusCode).toBe(201)
  })
})

describe('methods, addresses and cookies', () => {
  it.each([
    ['PUT', '/api/v1/auth/login'],
    ['PATCH', '/api/v1/feed'],
    ['DELETE', '/api/v1/feed'],
    ['POST', '/api/v1/feed'],
    ['GET', '/api/v1/beers'],
    ['PUT', '/api/v1/beers'],
    ['POST', '/api/v1/stats/me'],
    ['OPTIONS', '/api/v1/feed'],
  ] as Array<[HTTPMethods, string]>)(
    'answers %s %s with a plain 404',
    async (method, url) => {
      const res = await request(method, url)

      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('not_found')
    },
  )

  it('treats a HEAD request like the GET it mirrors', async () => {
    const health = await request('HEAD', '/api/v1/health')
    const feed = await request('HEAD', '/api/v1/feed')

    expect(health.statusCode).toBe(200)
    expect(health.body).toBe('')
    expect(feed.statusCode).toBe(401)
  })

  it.each([
    ['a trailing slash', '/api/v1/health/'],
    ['a doubled slash', '//api/v1/health'],
    ['capital letters', '/API/V1/health'],
  ])('answers an address with %s with a plain 404', async (_name, url) => {
    const res = await request('GET', url)

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })
  it('answers an address with an enormous name with 414, URI too long', async () => {
    const res = await request('GET', `/api/v1/photos/${'a'.repeat(300)}`)

    expect(res.statusCode).toBe(414)
  })

  it.each([
    ['a broken percent sign', 'session=%E0%A4%A'],
    ['a very long value', `session=${'x'.repeat(5000)}`],
    ['an empty value', 'session='],
    ['two sessions', 'session=aaaa; session=bbbb'],
    ['only punctuation', ';;;==='],
    ['a name with no value', 'session'],
  ])('answers a cookie with %s with 401, never 500', async (_name, cookie) => {
    const res = await request('GET', '/api/v1/auth/me', { headers: { cookie } })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthenticated')
  })

  it('ignores a query parameter it does not know', async () => {
    const { token } = await member(ctx)

    const res = await call(ctx, 'GET', '/api/v1/feed?surprise=yes', token)

    expect(res.statusCode).toBe(200)
  })

  it.each([
    ['a repeated parameter', 'limit=1&limit=2'],
    ['a broken percent sign', 'limit=%'],
  ])('refuses %s in the query with 400', async (_name, query) => {
    const { token } = await member(ctx)

    const res = await call(ctx, 'GET', `/api/v1/feed?${query}`, token)

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })
  it('treats a list-style parameter as an unknown one, and ignores it', async () => {
    const { user, token } = await member(ctx)
    for (let i = 0; i < 3; i++) await addPost(ctx.db, user.id)

    const res = await call(ctx, 'GET', '/api/v1/feed?limit[]=1', token)

    expect(res.statusCode).toBe(200)
    expect(res.json().posts).toHaveLength(3) // the limit was ignored, not obeyed
  })
})

describe('timeouts', () => {
  it('gives a request two minutes to arrive in full, enough for a slow phone upload', () => {
    expect(ctx.app.server.requestTimeout).toBe(120_000)
  })
})

describe('the log', () => {
  it('never contains passwords, session tokens or invite codes', async () => {
    const lines: string[] = []
    const app = await createTestApp(undefined, {
      logLevel: 'info',
      logStream: { write: (line: string) => void lines.push(line) },
    })
    try {
      await app.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'alice', password: 'PASSWORD-SECRET-1' },
      })
      await app.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          cookie: 'session=SESSION-SECRET-2',
          authorization: 'Bearer BEARER-SECRET-3',
        },
      })
      await app.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: 'bob',
          password: 'PASSWORD-SECRET-4',
          timeZone: 'America/New_York',
          inviteCode: 'INVITE-SECRET-5',
          ageConfirmed: true,
        },
      })

      const log = lines.join('')

      expect(log).toContain('"statusCode":401') // requests really are logged
      for (const secret of [
        'PASSWORD-SECRET',
        'SESSION-SECRET',
        'BEARER-SECRET',
        'INVITE-SECRET',
      ]) {
        expect(log).not.toContain(secret)
      }
    } finally {
      await app.close()
    }
  })
})
