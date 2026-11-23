import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { addPost } from '../test/factories.js'
import { call, member, type TestApp } from '../test/members.js'
import { createTestApp } from '../test/test-app.js'
import { resetTables } from '../test/test-db.js'

let clock = new Date('2026-01-15T20:00:00Z') // 3 pm in New York, 5 am the next day in Tokyo
let ctx: TestApp | undefined

async function app(): Promise<TestApp> {
  ctx ??= await createTestApp(undefined, { now: () => clock })
  return ctx
}

beforeEach(async () => {
  clock = new Date('2026-01-15T20:00:00Z')
  await resetTables((await app()).db)
})

afterAll(async () => {
  await ctx?.close()
})

const post = async (userId: number, localDate: string) =>
  addPost((await app()).db, userId, { localDate })

describe('GET /stats/me', () => {
  it('totals the day, month and year around today', async () => {
    const t = await app()
    const { user, token } = await member(t)
    for (const date of [
      '2025-12-31',
      '2026-01-15',
      '2026-01-15',
      '2026-01-20',
      '2026-02-03',
    ]) {
      await post(user.id, date)
    }

    const res = await call(t, 'GET', '/api/v1/stats/me', token)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      today: '2026-01-15',
      day: 2,
      month: 3,
      year: 4,
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('is all zeros for someone with no posts, and ignores other people', async () => {
    const t = await app()
    const alice = await member(t, 'alice')
    const bob = await member(t, 'bob')
    await post(bob.user.id, '2026-01-15')

    const res = await call(t, 'GET', '/api/v1/stats/me', alice.token)

    expect(res.json()).toEqual({
      today: '2026-01-15',
      day: 0,
      month: 0,
      year: 0,
    })
  })

  it('starts a new day at 5:00 am in the person\u2019s own time zone', async () => {
    const t = await app()
    const { token } = await member(t)

    clock = new Date('2026-01-15T09:59:59Z') // 4:59:59 am in New York
    expect((await call(t, 'GET', '/api/v1/stats/me', token)).json().today).toBe(
      '2026-01-14',
    )

    clock = new Date('2026-01-15T10:00:00Z') // 5:00:00 am in New York
    expect((await call(t, 'GET', '/api/v1/stats/me', token)).json().today).toBe(
      '2026-01-15',
    )
  })

  it('uses the zone of the person asking, not the server\u2019s or anyone else\u2019s', async () => {
    const t = await app()
    const tokyo = await member(t, 'tokyo', { timeZone: 'Asia/Tokyo' })
    const newYork = await member(t, 'newyork')

    clock = new Date('2026-01-15T19:59:59Z') // 4:59:59 am in Tokyo
    expect(
      (await call(t, 'GET', '/api/v1/stats/me', tokyo.token)).json().today,
    ).toBe('2026-01-15')

    clock = new Date('2026-01-15T20:00:00Z') // 5:00:00 am in Tokyo, 3 pm in New York
    expect(
      (await call(t, 'GET', '/api/v1/stats/me', tokyo.token)).json().today,
    ).toBe('2026-01-16')
    expect(
      (await call(t, 'GET', '/api/v1/stats/me', newYork.token)).json().today,
    ).toBe('2026-01-15')
  })

  it('refuses someone who is not logged in', async () => {
    const t = await app()

    expect((await call(t, 'GET', '/api/v1/stats/me')).statusCode).toBe(401)
  })
})

describe('GET /stats/leaderboard', () => {
  async function seed() {
    const t = await app()
    const alice = await member(t, 'alice')
    const bob = await member(t, 'bob')
    const carol = await member(t, 'carol')
    await member(t, 'dave') // never posts
    for (let i = 0; i < 3; i++) await post(alice.user.id, '2026-01-15')
    await post(bob.user.id, '2026-01-15')
    await post(bob.user.id, '2026-01-20')
    await post(carol.user.id, '2026-01-15')
    return { t, alice, bob, carol }
  }

  const summary = (
    rows: Array<{ username: string; count: number; rank: number }>,
  ) => rows.map(({ username, count, rank }) => ({ username, count, rank }))

  it.each([
    [
      'day',
      [
        { username: 'alice', count: 3, rank: 1 },
        { username: 'bob', count: 1, rank: 2 },
        { username: 'carol', count: 1, rank: 2 },
        { username: 'dave', count: 0, rank: 4 },
      ],
    ],
    [
      'month',
      [
        { username: 'alice', count: 3, rank: 1 },
        { username: 'bob', count: 2, rank: 2 },
        { username: 'carol', count: 1, rank: 3 },
        { username: 'dave', count: 0, rank: 4 },
      ],
    ],
    [
      'year',
      [
        { username: 'alice', count: 3, rank: 1 },
        { username: 'bob', count: 2, rank: 2 },
        { username: 'carol', count: 1, rank: 3 },
        { username: 'dave', count: 0, rank: 4 },
      ],
    ],
  ])(
    'ranks the %s, with ties sharing a rank and people with zero included',
    async (period, expected) => {
      const { t, alice } = await seed()

      const res = await call(
        t,
        'GET',
        `/api/v1/stats/leaderboard?period=${period}`,
        alice.token,
      )

      expect(res.statusCode).toBe(200)
      expect(summary(res.json().rows)).toEqual(expected)
      expect(res.headers['cache-control']).toBe('no-store')
    },
  )

  it.each([
    ['day', '2026-01-15', '2026-01-16'],
    ['month', '2026-01-01', '2026-02-01'],
    ['year', '2026-01-01', '2027-01-01'],
  ])('says which dates the %s covers', async (period, from, to) => {
    const { t, alice } = await seed()

    const body = (
      await call(
        t,
        'GET',
        `/api/v1/stats/leaderboard?period=${period}`,
        alice.token,
      )
    ).json()

    expect(body).toMatchObject({ period, date: '2026-01-15', from, to })
  })

  it('looks at a different day when asked', async () => {
    const { t, alice } = await seed()

    const body = (
      await call(
        t,
        'GET',
        '/api/v1/stats/leaderboard?period=day&date=2026-01-20',
        alice.token,
      )
    ).json()

    expect(body.date).toBe('2026-01-20')
    expect(summary(body.rows)).toEqual([
      { username: 'bob', count: 1, rank: 1 },
      { username: 'alice', count: 0, rank: 2 },
      { username: 'carol', count: 0, rank: 2 },
      { username: 'dave', count: 0, rank: 2 },
    ])
  })

  it('uses today in the viewer\u2019s own zone when no date is given', async () => {
    const { t } = await seed()
    const tokyo = await member(t, 'tokyo', { timeZone: 'Asia/Tokyo' })

    const body = (
      await call(t, 'GET', '/api/v1/stats/leaderboard?period=day', tokyo.token)
    ).json()

    expect(body.date).toBe('2026-01-16') // it is already 5 am the next day in Tokyo
    expect(body.rows.every((row: { count: number }) => row.count === 0)).toBe(
      true,
    )
  })

  it('shows only the rank, user, name and count of each person', async () => {
    const { t, alice } = await seed()

    const rows = (
      await call(t, 'GET', '/api/v1/stats/leaderboard?period=day', alice.token)
    ).json().rows

    expect(Object.keys(rows[0]).sort()).toEqual([
      'count',
      'rank',
      'userId',
      'username',
    ])
  })

  it.each([
    ['no period', ''],
    ['an unknown period', '?period=week'],
    ['an empty period', '?period='],
    ['a date that does not exist', '?period=day&date=2026-02-30'],
    ['a date written the wrong way', '?period=day&date=15/01/2026'],
    ['a date without leading zeros', '?period=day&date=2026-1-5'],
    ['a date with a time', '?period=day&date=2026-01-15T10:00:00Z'],
    ['a date in words', '?period=day&date=yesterday'],
    ['an empty date', '?period=day&date='],
  ])('refuses %s with 400', async (_name, query) => {
    const { t, alice } = await seed()

    const res = await call(
      t,
      'GET',
      `/api/v1/stats/leaderboard${query}`,
      alice.token,
    )

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('refuses someone who is not logged in', async () => {
    const { t } = await seed()

    expect(
      (await call(t, 'GET', '/api/v1/stats/leaderboard?period=day')).statusCode,
    ).toBe(401)
  })
})
describe('OpenAPI spec', () => {
  it('documents every endpoint added here', async () => {
    const t = await app()
    const spec = (
      await t.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    ).json()
    const codes = (path: string, method: string) =>
      Object.keys(spec.paths[path][method].responses)

    expect(codes('/api/v1/feed', 'get')).toEqual(
      expect.arrayContaining(['200', '400', '401']),
    )
    expect(codes('/api/v1/beers/{id}', 'delete')).toEqual(
      expect.arrayContaining(['204', '400', '401', '403', '404']),
    )
    expect(codes('/api/v1/stats/me', 'get')).toEqual(
      expect.arrayContaining(['200', '401']),
    )
    expect(codes('/api/v1/stats/leaderboard', 'get')).toEqual(
      expect.arrayContaining(['200', '400', '401']),
    )
    expect(spec.paths['/api/v1/photos/{name}'].get).toBeDefined()
  })
})
