import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createSession } from '../auth/sessions.js'
import { beerPosts, dailyCounts, users } from '../db/schema.js'
import { getLocalDate } from '../local-date.js'
import { detectImageType } from '../photos/image-type.js'
import { readPhotoMetadata } from '../photos/metadata.js'
import { InMemoryStorage, type PhotoStorage } from '../photos/storage.js'
import { multipartBody, type UploadPart } from '../test/api-helpers.js'
import { addUser } from '../test/factories.js'
import {
  gps,
  jpegOfSize,
  photoOfSize,
  plainJpeg,
  plainPng,
} from '../test/photos.js'
import { createTestApp } from '../test/test-app.js'
import { resetTables } from '../test/test-db.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const HOUR = 3_600_000
const DAY = 24 * HOUR
const url = '/api/v1/beers'

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

// A moment some hours ago, rounded to whole seconds, as a photo's clock would record it.
function takenAt(hoursAgo: number): Date {
  return new Date(Math.floor((Date.now() - hoursAgo * HOUR) / 1000) * 1000)
}

// The text a camera would write for that moment in a given time zone.
function exifClock(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toFormat('yyyy:MM:dd HH:mm:ss')
}

const photoPart = (
  data: Buffer,
  overrides: Partial<UploadPart> = {},
): UploadPart => ({
  name: 'photo',
  filename: 'photo.jpg',
  contentType: 'image/jpeg',
  data,
  ...overrides,
})

const field = (name: string, value: string): UploadPart => ({ name, value })

function send(
  target: TestApp,
  parts: UploadPart[],
  token?: string,
  headers: Record<string, string> = {},
) {
  const body = multipartBody(parts)
  return target.app.inject({
    method: 'POST',
    url,
    payload: body.payload,
    headers: { ...body.headers, ...headers },
    ...(token === undefined ? {} : { cookies: { session: token } }),
  })
}

async function member(target: TestApp = ctx, username = 'alice') {
  const user = await addUser(target.db, username)
  const { token } = await createSession(target.db, user.id)
  return { user, token }
}

async function expectNothingSaved(target: TestApp = ctx) {
  expect(target.memory.keys()).toEqual([])
  expect(await target.db.select().from(beerPosts)).toHaveLength(0)
  expect(await target.db.select().from(dailyCounts)).toHaveLength(0)
}
describe('POST /beers: a good upload', () => {
  it('creates the post from a photo with a time and a location', async () => {
    const { user, token } = await member()
    const taken = takenAt(3)
    const original = await photoOfSize(3000, 2000, {
      IFD2: { DateTimeOriginal: exifClock(taken, 'Asia/Tokyo') },
      IFD3: gps(35.6762, 139.6503),
    })

    const res = await send(
      ctx,
      [photoPart(original), field('caption', ' Cold one ')],
      token,
    )

    expect(res.statusCode).toBe(201)
    const { post } = res.json()
    expect(post).toMatchObject({
      username: 'alice',
      caption: 'Cold one',
      consumedAt: taken.toISOString(),
      timeZone: 'Asia/Tokyo',
      timeSource: 'exif',
      localDate: getLocalDate(taken, 'Asia/Tokyo'),
    })

    const [row] = await ctx.db.select().from(beerPosts)
    expect(row).toMatchObject({
      userId: user.id,
      timeSource: 'exif',
      timeZone: 'Asia/Tokyo',
    })
    expect(row?.imageKey).toMatch(/^photos\/[0-9a-f]{32}\.jpg$/)
    expect(post.imageUrl).toBe(`/api/v1/${row?.imageKey}`)
    expect(post.thumbUrl).toBe(`/api/v1/${row?.thumbKey}`)

    const [count] = await ctx.db.select().from(dailyCounts)
    expect(count).toMatchObject({
      userId: user.id,
      localDate: post.localDate,
      count: 1,
    })
  })

  it('stores a resized, metadata-free image and thumbnail, and nothing else', async () => {
    const { token } = await member()
    const original = await photoOfSize(3000, 2000, {
      IFD2: { DateTimeOriginal: exifClock(takenAt(2), 'Asia/Tokyo') },
      IFD3: gps(35.6762, 139.6503),
    })

    await send(ctx, [photoPart(original)], token)

    const [row] = await ctx.db.select().from(beerPosts)
    expect(ctx.memory.keys()).toEqual(
      [row?.imageKey ?? '', row?.thumbKey ?? ''].sort(),
    )
    const image = await ctx.memory.get(row?.imageKey ?? '')
    const thumb = await ctx.memory.get(row?.thumbKey ?? '')
    if (!image || !thumb) throw new Error('photos were not stored')

    const imageInfo = await sharp(image).metadata()
    const thumbInfo = await sharp(thumb).metadata()
    expect([imageInfo.width, imageInfo.height]).toEqual([1600, 1067])
    expect([thumbInfo.width, thumbInfo.height]).toEqual([480, 320])
    expect(await readPhotoMetadata(image)).toEqual({})
    expect(await readPhotoMetadata(thumb)).toEqual({})
  })

  it('uses a typed time when the photo has none, counted in the account zone', async () => {
    const { token } = await member()
    const manual = takenAt(2)

    const res = await send(
      ctx,
      [photoPart(await plainJpeg()), field('manualTime', manual.toISOString())],
      token,
    )

    expect(res.statusCode).toBe(201)
    expect(res.json().post).toMatchObject({
      consumedAt: manual.toISOString(),
      timeSource: 'manual',
      timeZone: 'America/New_York',
    })
  })

  it('lets a typed time override the photo time, while the photo still decides the zone', async () => {
    const { token } = await member()
    const manual = takenAt(1)
    const original = await photoOfSize(100, 100, {
      IFD2: { DateTimeOriginal: exifClock(takenAt(3), 'Asia/Tokyo') },
      IFD3: gps(35.6762, 139.6503),
    })

    const res = await send(
      ctx,
      [photoPart(original), field('manualTime', manual.toISOString())],
      token,
    )

    expect(res.json().post).toMatchObject({
      consumedAt: manual.toISOString(),
      timeSource: 'manual',
      timeZone: 'Asia/Tokyo',
    })
  })

  it.each([
    ['trims spaces', ' Cold one ', 'Cold one'],
    ['turns spaces only into no caption', '   ', null],
    ['turns an empty caption into no caption', '', null],
    ['accepts 140 emoji', '\u{1F37A}'.repeat(140), '\u{1F37A}'.repeat(140)],
  ])('%s', async (_name, caption, expected) => {
    const { token } = await member()

    const res = await send(
      ctx,
      [
        photoPart(await plainJpeg()),
        field('caption', caption),
        field('manualTime', takenAt(1).toISOString()),
      ],
      token,
    )

    expect(res.statusCode).toBe(201)
    expect(res.json().post.caption).toBe(expected)
  })

  it('treats the file by its bytes, not by the type the client claims', async () => {
    const { token } = await member()

    const res = await send(
      ctx,
      [
        photoPart(await plainPng(), {
          filename: 'beer.jpg',
          contentType: 'image/jpeg',
        }),
        field('manualTime', takenAt(1).toISOString()),
      ],
      token,
    )

    expect(res.statusCode).toBe(201)
    const [row] = await ctx.db.select().from(beerPosts)
    const stored = await ctx.memory.get(row?.imageKey ?? '')
    expect(stored && detectImageType(stored)).toBe('jpeg')
  })

  it('returns only safe fields, and says the answer must not be cached', async () => {
    const { token } = await member()
    const original = await photoOfSize(100, 100, {
      IFD2: { DateTimeOriginal: exifClock(takenAt(2), 'Asia/Tokyo') },
      IFD3: gps(35.6762, 139.6503),
    })

    const res = await send(ctx, [photoPart(original)], token)

    expect(Object.keys(res.json())).toEqual(['post'])
    expect(Object.keys(res.json().post).sort()).toEqual([
      'caption',
      'consumedAt',
      'createdAt',
      'id',
      'imageUrl',
      'localDate',
      'thumbUrl',
      'timeSource',
      'timeZone',
      'username',
    ])
    expect(res.body).not.toMatch(/imageKey|thumbKey|latitude|longitude|GPS/i)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('handles ten uploads at the same moment', async () => {
    const { token } = await member()
    const photo = await plainJpeg()
    const manual = takenAt(1).toISOString()

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        send(ctx, [photoPart(photo), field('manualTime', manual)], token),
      ),
    )

    expect(results.every((res) => res.statusCode === 201)).toBe(true)
    expect(await ctx.db.select().from(beerPosts)).toHaveLength(10)
    expect(ctx.memory.keys()).toHaveLength(20)
    const [count] = await ctx.db.select().from(dailyCounts)
    expect(count?.count).toBe(10)
  })
})
describe('POST /beers: refusals', () => {
  const noExif = async () => photoPart(await plainJpeg())

  it('asks for a time when the photo has none and none was typed', async () => {
    const { token } = await member()

    const res = await send(ctx, [await noExif()], token)

    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('time_required')
    await expectNothingSaved()
  })

  it.each([
    ['more than 7 days ago', new Date(Date.now() - 8 * DAY), 'time_too_old'],
    ['in the future', new Date(Date.now() + HOUR), 'time_in_future'],
  ])('refuses a typed time %s', async (_name, time, code) => {
    const { token } = await member()

    const res = await send(
      ctx,
      [await noExif(), field('manualTime', time.toISOString())],
      token,
    )

    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe(code)
    await expectNothingSaved()
  })

  it('refuses a photo whose own time is too old', async () => {
    const { token } = await member()
    const old = await photoOfSize(100, 100, {
      IFD2: {
        DateTimeOriginal: exifClock(
          new Date(Date.now() - 30 * DAY),
          'America/New_York',
        ),
      },
    })

    const res = await send(ctx, [photoPart(old)], token)

    expect(res.json().error.code).toBe('time_too_old')
    await expectNothingSaved()
  })

  it.each([
    ['a caption of 141 characters', [field('caption', 'a'.repeat(141))]],
    ['a caption with a NUL character', [field('caption', 'bad\u0000caption')]],
    ['a time with no offset', [field('manualTime', '2026-01-15T09:42:10')]],
    ['a time that is not a time', [field('manualTime', 'yesterday')]],
    ['a field it does not know', [field('sneaky', 'value')]],
  ])('refuses %s', async (_name, extra) => {
    const { token } = await member()

    const res = await send(ctx, [await noExif(), ...extra], token)

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
    await expectNothingSaved()
  })

  it.each([
    [
      'no photo at all',
      [field('manualTime', takenAt(1).toISOString())],
      'photo_required',
    ],
    [
      'a file in the wrong field',
      [photoPart(Buffer.from('x'), { name: 'file' })],
      'unknown_field',
    ],
    [
      'the same field twice',
      [field('caption', 'one'), field('caption', 'two')],
      'duplicate_field',
    ],
  ])('refuses %s', async (_name, parts, code) => {
    const { token } = await member()

    const res = await send(ctx, parts, token)

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    await expectNothingSaved()
  })

  it('refuses two photos', async () => {
    const { token } = await member()
    const photo = await plainJpeg()

    const res = await send(ctx, [photoPart(photo), photoPart(photo)], token)

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('too_many_files')
    await expectNothingSaved()
  })

  it('refuses an upload that is cut off', async () => {
    const { token } = await member()
    const body = multipartBody([photoPart(await plainJpeg())])
    const cut = body.payload.subarray(0, body.payload.length - 40)

    const res = await ctx.app.inject({
      method: 'POST',
      url,
      payload: cut,
      headers: body.headers,
      cookies: { session: token },
    })

    expect(res.statusCode).toBe(400)
    await expectNothingSaved()
  })

  it('refuses a request that is not a form upload', async () => {
    const { token } = await member()

    const res = await ctx.app.inject({
      method: 'POST',
      url,
      payload: { caption: 'hello' },
      cookies: { session: token },
    })

    expect(res.statusCode).toBe(415)
    expect(res.json().error.code).toBe('multipart_required')
  })

  it.each([
    [
      'a GIF',
      Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1'),
      415,
      'unsupported_format',
    ],
    [
      'text that claims to be a JPEG',
      Buffer.from('hello, I am not a photo'),
      415,
      'unsupported_format',
    ],
    [
      'a JPEG header followed by garbage',
      Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(500, 7)]),
      422,
      'invalid_image',
    ],
  ])('refuses %s', async (_name, data, status, code) => {
    const { token } = await member()

    const res = await send(
      ctx,
      [photoPart(data), field('manualTime', takenAt(1).toISOString())],
      token,
    )

    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    await expectNothingSaved()
  })

  it('refuses a HEIC photo with a message that says what to do', async () => {
    const { token } = await member()
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic'),
      Buffer.alloc(200),
    ])

    const res = await send(
      ctx,
      [photoPart(heic), field('manualTime', takenAt(1).toISOString())],
      token,
    )

    expect(res.statusCode).toBe(415)
    expect(res.json().error.code).toBe('heic_not_supported')
    expect(res.json().error.message).toContain('Most Compatible')
    await expectNothingSaved()
  })
})

describe('POST /beers: size limits', () => {
  async function limited(maxBytes?: number, maxPixels?: number) {
    return createTestApp(undefined, { photoLimits: { maxBytes, maxPixels } })
  }

  it('accepts a file exactly at the size limit and refuses one a byte over', async () => {
    const photo = await plainJpeg()
    const manual = field('manualTime', takenAt(1).toISOString())
    const small = await limited(photo.length)
    try {
      const { token } = await member(small)
      expect(
        (await send(small, [photoPart(photo), manual], token)).statusCode,
      ).toBe(201)
    } finally {
      await small.close()
    }

    const tight = await limited(photo.length - 1)
    try {
      const { token } = await member(tight, 'bob')
      const res = await send(tight, [photoPart(photo), manual], token)
      expect(res.statusCode).toBe(413)
      expect(res.json().error.code).toBe('photo_too_large')
    } finally {
      await tight.close()
    }
  })

  it('refuses a file far over the limit without storing anything', async () => {
    const app = await limited(20_000)
    try {
      const { token } = await member(app)
      const huge = Buffer.concat([await plainJpeg(), Buffer.alloc(50_000)])

      const res = await send(
        app,
        [photoPart(huge), field('manualTime', takenAt(1).toISOString())],
        token,
      )

      expect(res.statusCode).toBe(413)
      await expectNothingSaved(app)
    } finally {
      await app.close()
    }
  })

  it('refuses an image with too many pixels, and accepts one exactly at the limit', async () => {
    const app = await limited(undefined, 10_000)
    try {
      const { token } = await member(app)
      const manual = field('manualTime', takenAt(1).toISOString())

      const fits = await send(
        app,
        [photoPart(await jpegOfSize(100, 100)), manual],
        token,
      )
      const tooBig = await send(
        app,
        [photoPart(await jpegOfSize(101, 100)), manual],
        token,
      )

      expect(fits.statusCode).toBe(201)
      expect(tooBig.statusCode).toBe(413)
      expect(tooBig.json().error.code).toBe('photo_too_large')
    } finally {
      await app.close()
    }
  })
})
describe('POST /beers: who may upload', () => {
  it('refuses someone who is not logged in, before looking at the photo', async () => {
    const res = await send(ctx, [photoPart(await plainJpeg())])

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthenticated')
    await expectNothingSaved()
  })

  it('refuses an upload from a foreign origin', async () => {
    const { token } = await member()

    const res = await send(ctx, [photoPart(await plainJpeg())], token, {
      origin: 'https://evil.example',
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden_origin')
    await expectNothingSaved()
  })
})

describe('POST /beers: the upload limit', () => {
  it('limits each person separately, and logged-out requests by address', async () => {
    const app = await createTestApp(undefined, {
      uploadRateLimit: { max: 3, windowSeconds: 60 },
    })
    try {
      const alice = await member(app, 'alice')
      const bob = await member(app, 'bob')
      const attempt = (token?: string) => send(app, [], token) // fails fast, but still counts

      const aliceStatuses: number[] = []
      for (let i = 0; i < 4; i++)
        aliceStatuses.push((await attempt(alice.token)).statusCode)

      expect(aliceStatuses).toEqual([400, 400, 400, 429])
      expect((await attempt(bob.token)).statusCode).toBe(400)

      const strangers: number[] = []
      for (let i = 0; i < 4; i++) strangers.push((await attempt()).statusCode)
      expect(strangers).toEqual([401, 401, 401, 429])
    } finally {
      await app.close()
    }
  })
})

describe('POST /beers: when saving the post fails', () => {
  it('removes the files it had already stored', async () => {
    const memory = new InMemoryStorage()
    let sabotage: () => Promise<void> = async () => {}
    const storage: PhotoStorage = {
      put: async (key, data) => {
        await memory.put(key, data)
        if (key.endsWith('-thumb.jpg')) await sabotage() // the user vanishes mid-upload
      },
      get: (key) => memory.get(key),
      delete: (key) => memory.delete(key),
    }
    const app = await createTestApp(undefined, { storage })
    try {
      const { user, token } = await member(app)
      sabotage = async () => {
        await app.db.delete(users).where(eq(users.id, user.id))
      }

      const res = await send(
        app,
        [
          photoPart(await plainJpeg()),
          field('manualTime', takenAt(1).toISOString()),
        ],
        token,
      )

      expect(res.statusCode).toBe(500)
      expect(res.json().error.code).toBe('internal_error')
      expect(memory.keys()).toEqual([])
      expect(await app.db.select().from(beerPosts)).toHaveLength(0)
      expect(await app.db.select().from(dailyCounts)).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})

describe('POST /beers: the OpenAPI spec', () => {
  it('documents the endpoint and every way it can answer', async () => {
    const spec = (
      await ctx.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    ).json()

    expect(Object.keys(spec.paths['/api/v1/beers'].post.responses)).toEqual(
      expect.arrayContaining([
        '201',
        '400',
        '401',
        '403',
        '413',
        '415',
        '422',
        '429',
      ]),
    )
  })
})
