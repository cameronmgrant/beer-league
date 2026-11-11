import { describe, expect, it } from 'vitest'
import { isRequestOriginAllowed, type OriginCheckInput } from './csrf.js'

const allowed = ['https://beerleague.example', 'http://localhost:5173']

function check(
  input: Partial<OriginCheckInput>,
  origins: readonly string[] = allowed,
) {
  return isRequestOriginAllowed(
    { method: 'POST', origin: undefined, secFetchSite: undefined, ...input },
    origins,
  )
}

describe('isRequestOriginAllowed', () => {
  it.each(['https://beerleague.example', 'http://localhost:5173'])(
    'allows a change from the allowed origin %s',
    (origin) => {
      expect(check({ origin })).toBe(true)
    },
  )

  it.each([
    ['another site', 'https://evil.example'],
    [
      'an allowed host as part of a longer name',
      'https://beerleague.example.evil.com',
    ],
    [
      'an allowed name as a subdomain of another site',
      'https://evil.com/beerleague.example',
    ],
    ['the right host over plain http', 'http://beerleague.example'],
    ['the right host on another port', 'https://beerleague.example:8443'],
    ['a subdomain of an allowed origin', 'https://www.beerleague.example'],
    ['an origin with a trailing slash', 'https://beerleague.example/'],
    ['an origin in capital letters', 'HTTPS://BEERLEAGUE.EXAMPLE'],
    ['the opaque origin "null"', 'null'],
    ['an empty origin', ''],
  ])('refuses a change from %s', (_name, origin) => {
    expect(check({ origin })).toBe(false)
  })

  it.each(['PUT', 'PATCH', 'DELETE', 'post', 'delete'])(
    'checks %s requests too',
    (method) => {
      expect(check({ method, origin: 'https://evil.example' })).toBe(false)
      expect(check({ method, origin: 'https://beerleague.example' })).toBe(true)
    },
  )

  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])(
    'never checks %s requests',
    (method) => {
      expect(check({ method, origin: 'https://evil.example' })).toBe(true)
      expect(check({ method, secFetchSite: 'cross-site' })).toBe(true)
    },
  )

  it.each(['same-origin', 'none'])(
    'allows a request that says its fetch site is "%s"',
    (site) => {
      expect(check({ secFetchSite: site })).toBe(true)
    },
  )

  it.each(['cross-site', 'same-site', 'something-new', ''])(
    'refuses a request that says its fetch site is "%s"',
    (site) => {
      expect(check({ secFetchSite: site })).toBe(false)
    },
  )

  it('lets the origin decide when both headers are present', () => {
    expect(
      check({
        origin: 'https://beerleague.example',
        secFetchSite: 'cross-site',
      }),
    ).toBe(true)
    expect(
      check({ origin: 'https://evil.example', secFetchSite: 'same-origin' }),
    ).toBe(false)
  })

  it('allows a request with neither header, which cannot be a cross-site browser request', () => {
    expect(check({})).toBe(true)
  })

  it('refuses every origin when none are allowed, but not requests without one', () => {
    expect(check({ origin: 'https://beerleague.example' }, [])).toBe(false)
    expect(check({}, [])).toBe(true)
  })
})
