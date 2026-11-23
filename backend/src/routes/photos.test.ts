import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorage, type PhotoStorage } from '../photos/storage.js'
import { call, member, type TestApp } from '../test/members.js'
import { plainJpeg } from '../test/photos.js'
import { createTestApp } from '../test/test-app.js'
import { resetTables } from '../test/test-db.js'

const id = '0123456789abcdef0123456789abcdef'
const imageUrl = `/api/v1/photos/${id}.jpg`
const thumbUrl = `/api/v1/photos/${id}-thumb.jpg`

const memory = new InMemoryStorage()
let lookups = 0
// A storage that counts how often it is asked for a file.
const counting: PhotoStorage = {
  put: (key, data) => memory.put(key, data),
  get: async (key) => {
    lookups++
    return memory.get(key)
  },
  delete: (key) => memory.delete(key),
}

let ctx: TestApp

beforeAll(async () => {
  ctx = await createTestApp(undefined, { storage: counting })
})

beforeEach(async () => {
  await resetTables(ctx.db)
  memory.clear()
  lookups = 0
})

afterAll(async () => {
  await ctx.close()
})

describe('GET /photos/:name', () => {
  it('serves a stored image and its thumbnail, byte for byte, to a logged-in member', async () => {
    const { token } = await member(ctx)
    const big = await plainJpeg()
    const small = Buffer.from('thumbnail bytes')
    await memory.put(`photos/${id}.jpg`, big)
    await memory.put(`photos/${id}-thumb.jpg`, small)

    const image = await call(ctx, 'GET', imageUrl, token)
    const thumb = await call(ctx, 'GET', thumbUrl, token)

    expect(image.statusCode).toBe(200)
    expect(image.headers['content-type']).toBe('image/jpeg')
    expect(image.rawPayload.equals(big)).toBe(true)
    expect(thumb.rawPayload.equals(small)).toBe(true)
  })

  it('lets the browser keep it privately for a long time, and not guess its type', async () => {
    const { token } = await member(ctx)
    await memory.put(`photos/${id}.jpg`, await plainJpeg())

    const res = await call(ctx, 'GET', imageUrl, token)

    expect(res.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable',
    )
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('shows any member the photo, not only the person who posted it', async () => {
    await memory.put(`photos/${id}.jpg`, await plainJpeg())
    const { token } = await member(ctx, 'someone_else')

    expect((await call(ctx, 'GET', imageUrl, token)).statusCode).toBe(200)
  })

  it('refuses someone who is not logged in, without touching storage', async () => {
    await memory.put(`photos/${id}.jpg`, await plainJpeg())

    const res = await call(ctx, 'GET', imageUrl)

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthenticated')
    expect(lookups).toBe(0)
  })

  it('answers 404 for a photo that is not there', async () => {
    const { token } = await member(ctx)

    const res = await call(ctx, 'GET', imageUrl, token)

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })

  it.each([
    ['a path that climbs out', '..%2Fsecret.jpg'],
    ['an encoded climb', '%2e%2e%2f%2e%2e%2fetc%2fpasswd'],
    ['capital letters', `${id.toUpperCase()}.jpg`],
    ['a short name', `${id.slice(1)}.jpg`],
    ['a long name', `${id}0.jpg`],
    ['letters that are not hexadecimal', `${'g'.repeat(32)}.jpg`],
    ['another file type', `${id}.png`],
    ['no extension', id],
    ['a double extension', `${id}.jpg.jpg`],
    ['a NUL character', `${id}%00.jpg`],
    ['a thumbnail marker with no dash', `${id}thumb.jpg`],
  ])('answers 404 for %s, and never asks storage', async (_name, name) => {
    const { token } = await member(ctx)

    const res = await call(ctx, 'GET', `/api/v1/photos/${name}`, token)

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
    expect(lookups).toBe(0)
  })
})
