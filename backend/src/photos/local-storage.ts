import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import {
  InvalidKeyError,
  assertValidKey,
  type PhotoStorage,
} from './storage.js'

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class LocalDiskStorage implements PhotoStorage {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private pathFor(key: string): string {
    assertValidKey(key)
    const path = resolve(this.root, key)
    // The key shape already rules this out; this is a second, independent check.
    if (!path.startsWith(this.root + sep)) throw new InvalidKeyError(key)
    return path
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })

    // Write to a temporary name, then rename. A rename is all-or-nothing, so a reader
    // never sees a half-written photo, and two writers never produce a mixture.
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(temporary, data)
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async get(key: string): Promise<Buffer | undefined> {
    const path = this.pathFor(key)
    try {
      return await readFile(path)
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }
}
