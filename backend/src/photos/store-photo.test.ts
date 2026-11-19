import { describe, expect, it } from 'vitest'
import type { ProcessedPhoto } from './process.js'
import { removePhoto, storePhoto } from './store-photo.js'
import { InMemoryStorage, type PhotoStorage } from './storage.js'

const photo: ProcessedPhoto = {
  metadata: {},
  image: { data: Buffer.from('big picture'), width: 1600, height: 1200 },
  thumbnail: { data: Buffer.from('small picture'), width: 480, height: 360 },
}

// A storage that fails when asked to save certain keys.
function failing(
  inner: PhotoStorage,
  shouldFail: (key: string) => boolean,
): PhotoStorage {
  return {
    put: async (key, data) => {
      if (shouldFail(key)) throw new Error('disk full')
      return inner.put(key, data)
    },
    get: (key) => inner.get(key),
    delete: (key) => inner.delete(key),
  }
}

describe('storePhoto', () => {
  it('saves the image and its thumbnail under new keys', async () => {
    const storage = new InMemoryStorage()

    const keys = await storePhoto(storage, photo)

    expect(await storage.get(keys.imageKey)).toEqual(Buffer.from('big picture'))
    expect(await storage.get(keys.thumbKey)).toEqual(
      Buffer.from('small picture'),
    )
  })

  it('uses different keys every time', async () => {
    const storage = new InMemoryStorage()

    const first = await storePhoto(storage, photo)
    const second = await storePhoto(storage, photo)

    expect(first.imageKey).not.toBe(second.imageKey)
    expect(first.thumbKey).not.toBe(second.thumbKey)
  })

  it('leaves nothing behind when the thumbnail cannot be saved', async () => {
    const inner = new InMemoryStorage()
    const storage = failing(inner, (key) => key.endsWith('-thumb.jpg'))
    let imageKey = ''
    const recording: PhotoStorage = {
      ...storage,
      put: async (key, data) => {
        if (!key.endsWith('-thumb.jpg')) imageKey = key
        return storage.put(key, data)
      },
    }

    await expect(storePhoto(recording, photo)).rejects.toThrow('disk full')

    expect(imageKey).not.toBe('')
    expect(await inner.get(imageKey)).toBeUndefined()
  })

  it('stores nothing when the image itself cannot be saved', async () => {
    const inner = new InMemoryStorage()
    const storage = failing(inner, () => true)

    await expect(storePhoto(storage, photo)).rejects.toThrow('disk full')
  })

  it('still reports the original failure when cleaning up fails too', async () => {
    const inner = new InMemoryStorage()
    const storage: PhotoStorage = {
      put: async (key, data) => {
        if (key.endsWith('-thumb.jpg')) throw new Error('disk full')
        return inner.put(key, data)
      },
      get: (key) => inner.get(key),
      delete: async () => {
        throw new Error('cannot delete')
      },
    }

    await expect(storePhoto(storage, photo)).rejects.toThrow('disk full')
  })
})

describe('removePhoto', () => {
  it('removes both files', async () => {
    const storage = new InMemoryStorage()
    const keys = await storePhoto(storage, photo)

    await removePhoto(storage, keys)

    expect(await storage.get(keys.imageKey)).toBeUndefined()
    expect(await storage.get(keys.thumbKey)).toBeUndefined()
  })

  it('removes the other file even if one removal fails', async () => {
    const inner = new InMemoryStorage()
    const keys = await storePhoto(inner, photo)
    const storage: PhotoStorage = {
      put: (key, data) => inner.put(key, data),
      get: (key) => inner.get(key),
      delete: async (key) => {
        if (key === keys.imageKey) throw new Error('cannot delete')
        return inner.delete(key)
      },
    }

    await expect(removePhoto(storage, keys)).resolves.toBeUndefined()

    expect(await inner.get(keys.thumbKey)).toBeUndefined()
  })

  it('does nothing for files that are already gone', async () => {
    const storage = new InMemoryStorage()

    await expect(
      removePhoto(storage, {
        imageKey: 'photos/gone.jpg',
        thumbKey: 'photos/gone-thumb.jpg',
      }),
    ).resolves.toBeUndefined()
  })
})
