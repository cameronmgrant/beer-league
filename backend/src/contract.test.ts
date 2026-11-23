import { compileErrors, validate } from '@readme/openapi-parser'
import type { HTTPMethods } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp } from './test/test-app.js'
import type { TestApp } from './test/members.js'

interface RouteInfo {
  method: HTTPMethods
  path: string // written the way OpenAPI writes it, with {name} for parameters
}

// The whole public surface of the API. Adding or removing a route means updating this list on purpose.
const EXPECTED_ROUTES = [
  'DELETE /api/v1/beers/{id}',
  'GET /api/v1/auth/me',
  'GET /api/v1/feed',
  'GET /api/v1/health',
  'GET /api/v1/openapi.json',
  'GET /api/v1/photos/{name}',
  'GET /api/v1/stats/leaderboard',
  'GET /api/v1/stats/me',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/register',
  'POST /api/v1/beers',
]

// The only routes that may be used without being logged in.
const OPEN = new Set([
  'GET /api/v1/health',
  'GET /api/v1/openapi.json',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
])

const GOOD_ORIGIN = 'https://app.example'
const EVIL_ORIGIN = 'https://evil.example'
const routes: RouteInfo[] = []
let ctx: TestApp

beforeAll(async () => {
  ctx = await createTestApp(
    (app) => {
      app.addHook('onRoute', (route) => {
        const methods = Array.isArray(route.method)
          ? route.method
          : [route.method]
        for (const method of methods) {
          if (method === 'HEAD' || method === 'OPTIONS') continue
          if (!route.url.startsWith('/api/v1/')) continue
          routes.push({ method, path: route.url.replace(/:(\w+)/g, '{$1}') })
        }
      })
    },
    { allowedOrigins: [GOOD_ORIGIN] },
  )
})

afterAll(async () => {
  await ctx.close()
})

const label = (route: RouteInfo) => `${route.method} ${route.path}`
const sample = (path: string) =>
  path.replace('{id}', '1').replace('{name}', `${'a'.repeat(32)}.jpg`)
const send = (route: RouteInfo, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: route.method, url: sample(route.path), headers })

async function spec() {
  return (
    await ctx.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
  ).json()
}

describe('the API surface', () => {
  it('is exactly the list of routes we expect', () => {
    expect(routes.map(label).sort()).toEqual([...EXPECTED_ROUTES].sort())
  })

  it('is documented route for route, with nothing documented that does not exist', async () => {
    const document = await spec()
    const verbs = ['get', 'post', 'put', 'patch', 'delete']
    const documented = Object.entries<Record<string, unknown>>(
      document.paths,
    ).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => verbs.includes(key))
        .map((verb) => `${verb.toUpperCase()} ${path}`),
    )
    const real = routes
      .map(label)
      .filter((name) => name !== 'GET /api/v1/openapi.json')

    expect(documented.sort()).toEqual(real.sort())
  })

  it('is described by a valid OpenAPI document', async () => {
    const result = await validate(structuredClone(await spec()))

    expect(result.valid, result.valid ? '' : compileErrors(result)).toBe(true)
  })
})

describe('login', () => {
  it('is required on every route that is not on the short list of open ones, before any input is checked', async () => {
    const protectedRoutes = routes.filter((route) => !OPEN.has(label(route)))
    expect(protectedRoutes.length).toBeGreaterThanOrEqual(7)

    for (const route of protectedRoutes) {
      const res = await send(route)

      expect(res.statusCode, label(route)).toBe(401)
      expect(res.json().error.code, label(route)).toBe('unauthenticated')
    }
  })
})

describe('the origin check', () => {
  const changing = () => routes.filter((route) => route.method !== 'GET')

  it('refuses a request that changes data from a foreign origin, on every route that changes data', async () => {
    expect(changing().length).toBeGreaterThanOrEqual(5)

    for (const route of changing()) {
      const res = await send(route, { origin: EVIL_ORIGIN })

      expect(res.statusCode, label(route)).toBe(403)
      expect(res.json().error.code, label(route)).toBe('forbidden_origin')
    }
  })

  it('lets the same requests through the origin check from the allowed origin', async () => {
    for (const route of changing()) {
      const res = await send(route, { origin: GOOD_ORIGIN })

      expect(res.statusCode, label(route)).not.toBe(403)
    }
  })
})

describe('methods', () => {
  it('answers a method no route has with a plain 404, on every address', async () => {
    const paths = [...new Set(routes.map((route) => route.path))]

    for (const path of paths) {
      const res = await ctx.app.inject({ method: 'PATCH', url: sample(path) })

      expect(res.statusCode, path).toBe(404)
      expect(res.json().error.code, path).toBe('not_found')
    }
  })
})
