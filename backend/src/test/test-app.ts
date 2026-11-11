import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { createTestDb } from './test-db.js'

// Builds the real app on top of the test database. The optional callback lets a
// test add routes of its own before the app starts.
export async function createTestApp(
  extend?: (app: FastifyInstance) => void,
  options: { cookieSecure?: boolean } = {},
) {
  const { db, pool } = createTestDb()
  const app = buildApp({ db, ...options })
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
