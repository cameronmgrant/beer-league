import { randomBytes } from 'node:crypto'

export interface PhotoStorage {
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer | undefined>
  delete(key: string): Promise<void>
}

export class InvalidKeyError extends Error {
  constructor(key: string) {
    super(`Invalid storage key: ${JSON.stringify(key).slice(0, 80)}`)
    this.name = 'InvalidKeyError'
  }
}

// Folders and file names of lowercase letters, digits, "_" and "-", ending in ".jpg".
// Nothing else is allowed, which rules out "..", absolute paths and hidden files by construction.
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.jpg$/

export function assertValidKey(key: string): void {
  if (key.length > 200 || !KEY_PATTERN.test(key)) throw new InvalidKeyError(key)
}

export class InMemoryStorage implements PhotoStorage {
  private readonly files = new Map<string, Buffer>()

  async put(key: string, data: Buffer): Promise<void> {
    assertValidKey(key)
    this.files.set(key, Buffer.from(data))
  }

  async get(key: string): Promise<Buffer | undefined> {
    assertValidKey(key)
    const stored = this.files.get(key)
    return stored === undefined ? undefined : Buffer.from(stored)
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key)
    this.files.delete(key)
  }
  keys(): string[] {
    return [...this.files.keys()].sort()
  }

  clear(): void {
    this.files.clear()
  }
}

export function newPhotoKeys(): { imageKey: string; thumbKey: string } {
  const id = randomBytes(16).toString('hex')
  return { imageKey: `photos/${id}.jpg`, thumbKey: `photos/${id}-thumb.jpg` }
}
