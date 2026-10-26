import 'dotenv/config'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb } from '../db/client.js'

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set (copy backend/.env.example to backend/.env)',
    )
  }
  const { db, pool } = createDb(url)
  try {
    await migrate(db, { migrationsFolder: './drizzle' })
  } finally {
    await pool.end()
  }
}
