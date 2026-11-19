import type { ProcessedPhoto } from './process.js'
import { newPhotoKeys, type PhotoStorage } from './storage.js'

export interface StoredPhoto {
  imageKey: string
  thumbKey: string
}

export async function storePhoto(
  storage: PhotoStorage,
  photo: ProcessedPhoto,
): Promise<StoredPhoto> {
  const keys = newPhotoKeys()

  await storage.put(keys.imageKey, photo.image.data)
  try {
    await storage.put(keys.thumbKey, photo.thumbnail.data)
  } catch (error) {
    // Do not leave a lone image behind. Cleanup trouble must not hide the real problem.
    await storage.delete(keys.imageKey).catch(() => undefined)
    throw error
  }

  return keys
}

// Best effort: tries both files, and never throws, so it is safe to call while handling another error.
export async function removePhoto(
  storage: PhotoStorage,
  keys: StoredPhoto,
): Promise<void> {
  await Promise.allSettled([
    storage.delete(keys.imageKey),
    storage.delete(keys.thumbKey),
  ])
}
