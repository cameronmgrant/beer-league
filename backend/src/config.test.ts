import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const databaseUrl = 'postgres://beer:beer@localhost:5432/beer_league'
const valid = { DATABASE_URL: databaseUrl }

describe('loadConfig', () => {
  it('fills in defaults', () => {
    expect(loadConfig(valid)).toEqual({
      nodeEnv: 'development',
      port: 3000,
      host: '0.0.0.0',
      databaseUrl,
      logLevel: 'info',
      allowedOrigins: ['http://localhost:3000', 'http://localhost:5173'],
      trustProxyHops: 0,
      authRateLimit: { max: 10, windowSeconds: 60 },
    })
  })

  it('reads every setting, turning numbers into numbers', () => {
    const config = loadConfig({
      ...valid,
      NODE_ENV: 'production',
      PORT: '8080',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'debug',
      ALLOWED_ORIGINS: 'https://beerleague.example',
      TRUST_PROXY_HOPS: '1',
      AUTH_RATE_LIMIT_MAX: '5',
      AUTH_RATE_LIMIT_WINDOW_SECONDS: '120',
    })
    expect(config).toEqual({
      nodeEnv: 'production',
      port: 8080,
      host: '127.0.0.1',
      databaseUrl,
      logLevel: 'debug',
      allowedOrigins: ['https://beerleague.example'],
      trustProxyHops: 1,
      authRateLimit: { max: 5, windowSeconds: 120 },
    })
  })

  it.each([
    ['no database url', {}],
    ['an empty database url', { DATABASE_URL: '' }],
    [
      'a url for a different kind of database',
      { DATABASE_URL: 'mysql://u:p@host/db' },
    ],
    ['a port of zero', { ...valid, PORT: '0' }],
    ['a port above 65535', { ...valid, PORT: '65536' }],
    ['a port that is not a number', { ...valid, PORT: 'abc' }],
    ['a fractional port', { ...valid, PORT: '80.5' }],
    ['an unknown environment name', { ...valid, NODE_ENV: 'staging' }],
    ['an unknown log level', { ...valid, LOG_LEVEL: 'loud' }],
  ])('rejects %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow('Invalid configuration')
  })

  it('names every problem at once', () => {
    expect(() =>
      loadConfig({ ...valid, PORT: 'abc', NODE_ENV: 'nope' }),
    ).toThrow(/PORT.*NODE_ENV|NODE_ENV.*PORT/)
  })

  it('never puts the database password in the error', () => {
    const attempt = () =>
      loadConfig({ DATABASE_URL: 'mysql://user:hunter2@host/db' })
    expect(attempt).toThrow('Invalid configuration')
    expect(attempt).not.toThrow('hunter2')
  })
})

describe('loadConfig: protections', () => {
  it('reads a list of allowed origins, ignoring spaces and empty entries', () => {
    const config = loadConfig({
      ...valid,
      ALLOWED_ORIGINS: ' https://a.example , https://b.example:8443,, ',
    })

    expect(config.allowedOrigins).toEqual([
      'https://a.example',
      'https://b.example:8443',
    ])
  })

  it('refuses to run in production without allowed origins', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(
      'ALLOWED_ORIGINS',
    )
  })

  it.each([
    ['a bare host name', 'example.com'],
    ['an origin with a path', 'https://example.com/app'],
    ['an origin with a trailing slash', 'https://example.com/'],
    ['an origin in capital letters', 'HTTPS://EXAMPLE.COM'],
    ['another kind of address', 'ftp://example.com'],
    ['an empty list', ''],
    ['a list with one bad entry', 'https://ok.example,nope'],
  ])('rejects %s as the allowed origins', (_name, origins) => {
    expect(() => loadConfig({ ...valid, ALLOWED_ORIGINS: origins })).toThrow(
      'Invalid configuration',
    )
  })

  it.each([
    ['a negative number of proxies', { TRUST_PROXY_HOPS: '-1' }],
    ['more than five proxies', { TRUST_PROXY_HOPS: '6' }],
    ['a fractional number of proxies', { TRUST_PROXY_HOPS: '1.5' }],
    ['a rate limit of zero', { AUTH_RATE_LIMIT_MAX: '0' }],
    ['a rate limit that is not a number', { AUTH_RATE_LIMIT_MAX: 'lots' }],
    ['a window of zero seconds', { AUTH_RATE_LIMIT_WINDOW_SECONDS: '0' }],
    [
      'a window longer than an hour',
      { AUTH_RATE_LIMIT_WINDOW_SECONDS: '3601' },
    ],
  ])('rejects %s', (_name, extra) => {
    expect(() => loadConfig({ ...valid, ...extra })).toThrow(
      'Invalid configuration',
    )
  })
})
