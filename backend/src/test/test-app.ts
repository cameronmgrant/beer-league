import type { FastifyInstance } from 'fastify'
import { buildApp, type AppOptions } from '../app.js'
import { InMemoryStorage, type PhotoStorage } from '../photos/storage.js'
import { createTestDb } from './test-db.js'

// Builds the real app on top of the test database. The optional callback lets a
// test add routes of its own before the app starts. The login, sign-up and upload
// limits are very high so ordinary tests are not slowed down by them; the tests
// that are about rate limiting set them low.
export async function createTestApp(
  extend?: (app: FastifyInstance) => void,
  options: Omit<AppOptions, 'db' | 'storage'> & {
    storage?: PhotoStorage | undefined
  } = {},
) {
  const { db, pool } = createTestDb()
  const memory = new InMemoryStorage()
  const { storage = memory, ...rest } = options
  const app = buildApp({
    db,
    storage,
    authRateLimit: { max: 1000, windowSeconds: 60 },
    uploadRateLimit: { max: 1000, windowSeconds: 60 },
    ...rest,
  })
  extend?.(app)
  await app.ready()

  return {
    app,
    db,
    pool,
    memory,
    close: async () => {
      await app.close()
      await pool.end()
    },
  }
}
