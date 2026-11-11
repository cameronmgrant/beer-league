import type { FastifyInstance } from 'fastify'
import { buildApp, type AppOptions } from '../app.js'
import { createTestDb } from './test-db.js'

// Builds the real app on top of the test database. The optional callback lets a
// test add routes of its own before the app starts. The login and sign-up limit
// is set very high so ordinary tests are not slowed down by it; the tests that
// are about rate limiting set it low.
export async function createTestApp(
  extend?: (app: FastifyInstance) => void,
  options: Omit<AppOptions, 'db'> = {},
) {
  const { db, pool } = createTestDb()
  const app = buildApp({
    db,
    authRateLimit: { max: 1000, windowSeconds: 60 },
    ...options,
  })
  extend?.(app)
  await app.ready()

  return {
    app,
    db,
    pool,
    close: async () => {
      await app.close()
      await pool.end()
    },
  }
}
