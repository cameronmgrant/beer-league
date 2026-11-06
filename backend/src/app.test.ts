import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { buildApp } from './app.js'
import { AppError } from './errors.js'
import { createTestApp } from './test/test-app.js'
import { createTestDb } from './test/test-db.js'

let ctx: Awaited<ReturnType<typeof createTestApp>>

beforeAll(async () => {
  ctx = await createTestApp((app) => {
    app
      .withTypeProvider<ZodTypeProvider>()
      .post(
        '/test/echo',
        { schema: { body: z.object({ name: z.string().min(3) }) } },
        async (request) => ({ name: request.body.name }),
      )
    app.get('/test/not-yours', async () => {
      throw new AppError(403, 'forbidden', 'That post is not yours')
    })
    app.get('/test/boom', async () => {
      throw new Error('secret internal detail')
    })
  })
})

afterAll(async () => {
  await ctx.close()
})

describe('health', () => {
  it('reports ok when the database answers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('reports 503 when the database is not reachable', async () => {
    const { db, pool } = createTestDb()
    const app = buildApp({ db })
    await app.ready()
    await pool.end() // from now on, every database call fails

    const res = await app.inject({ method: 'GET', url: '/api/v1/health' })
    await app.close()

    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('database_unavailable')
  })
})

describe('error responses', () => {
  it('answers an unknown route with 404 in the standard shape', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({
      error: { code: 'not_found', message: 'No such route' },
    })
  })

  it('answers the wrong method with 404 too', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/health' })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })

  it('accepts a valid request body', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/test/echo',
      payload: { name: 'alice' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ name: 'alice' })
  })

  it.each([
    ['a value that is too short', { name: 'ab' }],
    ['a value of the wrong type', { name: 123 }],
    ['a missing field', {}],
  ])('rejects %s with 400 and says what was wrong', async (_name, payload) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/test/echo',
      payload,
    })
    const { error } = res.json()

    expect(res.statusCode).toBe(400)
    expect(error.code).toBe('validation_error')
    expect(error.details[0].where).toBe('body')
    expect(JSON.stringify(error.details)).toContain('name')
  })

  it('rejects a body that is not valid JSON with 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
  })

  it('passes on the status and message of a deliberate application error', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/test/not-yours' })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({
      error: { code: 'forbidden', message: 'That post is not yours' },
    })
  })

  it('hides the details of an unexpected failure', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/test/boom' })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('internal_error')
    expect(res.body).not.toContain('secret internal detail')
  })

  it.each([
    ['an unknown route', 'GET', '/api/v1/nope'],
    ['a deliberate error', 'GET', '/test/not-yours'],
    ['an unexpected failure', 'GET', '/test/boom'],
    ['invalid input', 'POST', '/test/echo'],
  ] as const)('uses the same envelope for %s', async (_name, method, url) => {
    const res = await ctx.app.inject(
      method === 'POST' ? { method, url, payload: {} } : { method, url },
    )
    const body = res.json()

    expect(Object.keys(body)).toEqual(['error'])
    expect(typeof body.error.code).toBe('string')
    expect(typeof body.error.message).toBe('string')
  })
})

describe('OpenAPI spec', () => {
  it('is served and describes the API', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/openapi.json',
    })
    const spec = res.json()

    expect(res.statusCode).toBe(200)
    expect(spec.openapi).toMatch(/^3\./)
    expect(spec.info.title).toBe('Beer League API')
    expect(spec.paths['/api/v1/health'].get).toBeDefined()
  })

  it('documents the failure response of the health check', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/openapi.json',
    })

    expect(
      res.json().paths['/api/v1/health'].get.responses['503'],
    ).toBeDefined()
  })

  it('does not list itself', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/openapi.json',
    })

    expect(res.json().paths['/api/v1/openapi.json']).toBeUndefined()
  })
})
