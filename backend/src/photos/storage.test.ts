import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDiskStorage } from './local-storage.js'
import {
  InMemoryStorage,
  InvalidKeyError,
  assertValidKey,
  newPhotoKeys,
  type PhotoStorage,
} from './storage.js'

interface Setup {
  storage: PhotoStorage
  cleanup: () => Promise<void>
}

function storageContract(name: string, setup: () => Promise<Setup>) {
  describe(`${name} storage`, () => {
    let ctx: Setup

    beforeEach(async () => {
      ctx = await setup()
    })

    afterEach(async () => {
      await ctx.cleanup()
    })

    it('returns exactly what was stored', async () => {
      const everyByte = Buffer.from(Array.from({ length: 256 }, (_, i) => i))

      await ctx.storage.put('photos/abc.jpg', everyByte)

      expect(await ctx.storage.get('photos/abc.jpg')).toEqual(everyByte)
    })

    it('returns undefined for a key that was never stored', async () => {
      expect(await ctx.storage.get('photos/missing.jpg')).toBeUndefined()
    })

    it('replaces an earlier value stored under the same key', async () => {
      await ctx.storage.put('photos/abc.jpg', Buffer.from('first'))
      await ctx.storage.put('photos/abc.jpg', Buffer.from('second'))

      expect(await ctx.storage.get('photos/abc.jpg')).toEqual(
        Buffer.from('second'),
      )
    })

    it('keeps different keys separate, including keys in different folders', async () => {
      await ctx.storage.put('a.jpg', Buffer.from('one'))
      await ctx.storage.put('photos/a.jpg', Buffer.from('two'))
      await ctx.storage.put('photos/2026/a.jpg', Buffer.from('three'))

      expect(await ctx.storage.get('a.jpg')).toEqual(Buffer.from('one'))
      expect(await ctx.storage.get('photos/a.jpg')).toEqual(Buffer.from('two'))
      expect(await ctx.storage.get('photos/2026/a.jpg')).toEqual(
        Buffer.from('three'),
      )
    })

    it('deletes a file, and deleting a missing one is not an error', async () => {
      await ctx.storage.put('photos/abc.jpg', Buffer.from('x'))

      await ctx.storage.delete('photos/abc.jpg')
      await ctx.storage.delete('photos/abc.jpg')
      await ctx.storage.delete('photos/never-existed.jpg')

      expect(await ctx.storage.get('photos/abc.jpg')).toBeUndefined()
    })

    it('does not let changes to a buffer reach what is stored', async () => {
      const data = Buffer.from('original')
      await ctx.storage.put('photos/abc.jpg', data)
      data.fill(0)

      expect(await ctx.storage.get('photos/abc.jpg')).toEqual(
        Buffer.from('original'),
      )
    })

    it('stores many files at the same time', async () => {
      const keys = Array.from({ length: 25 }, (_, i) => `photos/file-${i}.jpg`)

      await Promise.all(
        keys.map((key) => ctx.storage.put(key, Buffer.from(key))),
      )

      for (const key of keys)
        expect(await ctx.storage.get(key)).toEqual(Buffer.from(key))
    })

    it('never mixes two simultaneous writes to the same key', async () => {
      const first = Buffer.alloc(1_000_000, 1)
      const second = Buffer.alloc(1_000_000, 2)

      await Promise.all([
        ctx.storage.put('photos/race.jpg', first),
        ctx.storage.put('photos/race.jpg', second),
      ])

      const stored = await ctx.storage.get('photos/race.jpg')
      expect([
        first.equals(stored ?? Buffer.alloc(0)),
        second.equals(stored ?? Buffer.alloc(0)),
      ]).toContain(true)
    })

    it.each([
      ['an empty key', ''],
      ['a parent folder', '..'],
      ['a path that climbs out', '../escape.jpg'],
      ['a path that climbs out from inside', 'a/../../escape.jpg'],
      ['an absolute path', '/etc/passwd.jpg'],
      ['a backslash', 'a\\b.jpg'],
      ['a NUL character', 'a\u0000b.jpg'],
      ['an encoded dot-dot', 'a/..%2f.jpg'],
      ['a hidden file', 'photos/.hidden.jpg'],
      ['an empty folder name', 'a//b.jpg'],
      ['a trailing slash', 'a/b.jpg/'],
      ['another file type', 'photos/a.png'],
      ['no extension', 'photos/a'],
      ['capital letters', 'photos/ABC.jpg'],
      ['a space', 'photos/a b.jpg'],
      ['a key that is far too long', `${'a'.repeat(300)}.jpg`],
    ])('refuses %s as a key', async (_name, key) => {
      await expect(ctx.storage.put(key, Buffer.from('x'))).rejects.toThrow(
        InvalidKeyError,
      )
      await expect(ctx.storage.get(key)).rejects.toThrow(InvalidKeyError)
      await expect(ctx.storage.delete(key)).rejects.toThrow(InvalidKeyError)
    })
  })
}

storageContract('in-memory', async () => ({
  storage: new InMemoryStorage(),
  cleanup: async () => {},
}))

storageContract('local disk', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'beer-league-'))
  return {
    storage: new LocalDiskStorage(join(folder, 'photos-root')),
    cleanup: () => rm(folder, { recursive: true, force: true }),
  }
})

describe('local disk storage: details', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'beer-league-'))
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('creates its folder when it does not exist yet', async () => {
    const storage = new LocalDiskStorage(join(folder, 'new', 'deeper'))

    await storage.put('photos/abc.jpg', Buffer.from('x'))

    expect(await storage.get('photos/abc.jpg')).toEqual(Buffer.from('x'))
  })

  it('leaves no temporary files behind', async () => {
    const root = join(folder, 'root')
    const storage = new LocalDiskStorage(root)

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        storage.put(`photos/f${i}.jpg`, Buffer.alloc(50_000, i)),
      ),
    )

    const files = await readdir(root, { recursive: true })
    expect(files.filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('never writes outside its folder, even when asked to', async () => {
    const root = join(folder, 'root')
    await mkdir(root)
    const storage = new LocalDiskStorage(root)

    await expect(
      storage.put('../outside.jpg', Buffer.from('x')),
    ).rejects.toThrow(InvalidKeyError)

    expect(await readdir(folder)).toEqual(['root'])
  })
})

describe('assertValidKey', () => {
  it.each([
    'a.jpg',
    'photos/abc123.jpg',
    'photos/2026/abc-thumb.jpg',
    'photos/a_b-c.jpg',
    `${'a'.repeat(190)}.jpg`,
  ])('accepts %s', (key) => {
    expect(() => assertValidKey(key)).not.toThrow()
  })
})

describe('newPhotoKeys', () => {
  it('makes unguessable keys of a safe shape', () => {
    const { imageKey, thumbKey } = newPhotoKeys()

    expect(imageKey).toMatch(/^photos\/[0-9a-f]{32}\.jpg$/)
    expect(thumbKey).toMatch(/^photos\/[0-9a-f]{32}-thumb\.jpg$/)
    expect(() => assertValidKey(imageKey)).not.toThrow()
    expect(() => assertValidKey(thumbKey)).not.toThrow()
  })

  it('gives the image and its thumbnail the same id', () => {
    const { imageKey, thumbKey } = newPhotoKeys()

    expect(thumbKey).toBe(imageKey.replace('.jpg', '-thumb.jpg'))
  })

  it('does not repeat', () => {
    const ids = Array.from({ length: 2000 }, () => newPhotoKeys().imageKey)

    expect(new Set(ids).size).toBe(2000)
  })
})
describe('in-memory storage: test helpers', () => {
  it('lists its keys in order, and empties itself', async () => {
    const storage = new InMemoryStorage()
    await storage.put('photos/b.jpg', Buffer.from('1'))
    await storage.put('photos/a.jpg', Buffer.from('2'))

    expect(storage.keys()).toEqual(['photos/a.jpg', 'photos/b.jpg'])

    await storage.delete('photos/a.jpg')
    expect(storage.keys()).toEqual(['photos/b.jpg'])

    storage.clear()
    expect(storage.keys()).toEqual([])
  })
})
