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
    })
  })

  it('reads every setting, turning the port into a number', () => {
    const config = loadConfig({
      ...valid,
      NODE_ENV: 'production',
      PORT: '8080',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'debug',
    })
    expect(config).toEqual({
      nodeEnv: 'production',
      port: 8080,
      host: '127.0.0.1',
      databaseUrl,
      logLevel: 'debug',
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
